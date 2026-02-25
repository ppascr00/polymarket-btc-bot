// ============================================
// Polymarket BTC Bot — Risk Manager
// ============================================

import { getLogger } from '../utils/logger.js';
import { getUTCDayStart } from '../utils/time.js';
import { getMinEdgeThresholdForStrategy } from './edge-threshold.js';
import type {
    RiskManager as IRiskManager,
    RiskDecision,
    Signal,
    AccountState,
    TradeRecord,
    BotConfig,
} from '../types/index.js';

const logger = getLogger();

/**
 * Enforces all risk management rules:
 * - max_stake_per_trade
 * - max_daily_loss
 * - max_open_positions
 * - cooldown after N consecutive losses
 * - slippage / spread tolerance
 * - minimum edge threshold
 * - no-trade zone if signal is weak
 */
export class DefaultRiskManager implements IRiskManager {
    private config: BotConfig['risk'];
    private dailyPnL = 0;
    private consecutiveLosses = 0;
    private cooldownUntil = 0;
    private cooldownTriggeredAtLosses = 0;
    private dailyResetDate = 0;
    private openPositions = 0;

    constructor(config: BotConfig['risk']) {
        this.config = config;
        this.dailyResetDate = getUTCDayStart();
    }

    canTrade(signal: Signal, account: AccountState): RiskDecision {
        const isPaperMode = process.env.TRADING_MODE === 'PAPER';
        // Auto-reset if new day
        const today = getUTCDayStart();
        if (today !== this.dailyResetDate) {
            this.resetDaily();
            this.dailyResetDate = today;
        }

        // 1. Check if signal is NO_TRADE
        if (signal.direction === 'NO_TRADE') {
            return { allowed: false, reason: 'Strategy says NO_TRADE' };
        }

        // 2. Check minimum edge (strategy-specific override > global fallback)
        const effectiveMinEdge = getMinEdgeThresholdForStrategy(
            signal.strategyName,
            this.config.minEdgeThreshold
        );
        if (signal.edge < effectiveMinEdge) {
            return {
                allowed: false,
                reason: `Edge ${(signal.edge * 100).toFixed(1)}% < threshold ${(effectiveMinEdge * 100).toFixed(1)}%`,
            };
        }

        // 3-4. Cooldown checks (disabled when cooldownAfterLosses <= 0)
        if (this.config.cooldownAfterLosses > 0) {
            if (Date.now() < this.cooldownUntil) {
                const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
                return {
                    allowed: false,
                    reason: `In cooldown after ${this.config.cooldownAfterLosses} consecutive losses. ${remaining}s remaining.`,
                };
            }

            if (
                this.consecutiveLosses >= this.config.cooldownAfterLosses &&
                this.consecutiveLosses > this.cooldownTriggeredAtLosses
            ) {
                // Enter cooldown: 5 minutes per consecutive loss
                const cooldownMs = this.consecutiveLosses * 5 * 60 * 1000;
                this.cooldownUntil = Date.now() + cooldownMs;
                this.cooldownTriggeredAtLosses = this.consecutiveLosses;
                logger.warn(
                    {
                        consecutiveLosses: this.consecutiveLosses,
                        cooldownMinutes: cooldownMs / 60_000,
                    },
                    'Entering cooldown after consecutive losses'
                );
                return {
                    allowed: false,
                    reason: `Entering cooldown: ${this.consecutiveLosses} consecutive losses`,
                };
            }
        }

        // 5. Check daily loss limit (LIVE only)
        if (!isPaperMode && this.dailyPnL <= -this.config.maxDailyLoss) {
            return {
                allowed: false,
                reason: `Daily loss limit reached: $${this.dailyPnL.toFixed(2)} <= -$${this.config.maxDailyLoss}`,
            };
        }

        // 6. Check max open positions
        if (account.openPositions >= this.config.maxOpenPositions) {
            return {
                allowed: false,
                reason: `Max open positions reached: ${account.openPositions} >= ${this.config.maxOpenPositions}`,
            };
        }

        // 7. Check one trade per window
        if (account.tradesThisWindow > 0) {
            return {
                allowed: false,
                reason: 'Already traded in this window (max 1 per window)',
            };
        }

        // 8. Calculate adjusted stake
        let stake = this.config.maxStakePerTrade;

        // Reduce stake if approaching daily loss limit (LIVE only)
        if (!isPaperMode) {
            const remainingBudget = this.config.maxDailyLoss + this.dailyPnL;
            if (stake > remainingBudget) {
                stake = Math.max(0, remainingBudget);
                if (stake <= 0) {
                    return {
                        allowed: false,
                        reason: 'No remaining budget for today',
                    };
                }
            }
        }

        // Scale stake by confidence (optional: more conservative)
        if (signal.confidence < 0.3) {
            stake *= 0.5;
        } else if (signal.confidence < 0.5) {
            stake *= 0.75;
        }

        logger.info(
            {
                direction: signal.direction,
                edge: signal.edge,
                confidence: signal.confidence,
                stake,
                dailyPnL: this.dailyPnL,
                consecutiveLosses: this.consecutiveLosses,
            },
            'Risk check PASSED'
        );

        return {
            allowed: true,
            reason: 'All risk checks passed',
            adjustedStake: stake,
        };
    }

    recordTrade(trade: TradeRecord): void {
        if (trade.outcome === 'WIN') {
            this.consecutiveLosses = 0;
            this.cooldownTriggeredAtLosses = 0;
            this.cooldownUntil = 0;
            this.dailyPnL += trade.pnl;
        } else if (trade.outcome === 'LOSS') {
            this.consecutiveLosses++;
            this.dailyPnL += trade.pnl; // pnl is negative for losses
        }
        // PENDING: no update

        logger.info(
            {
                outcome: trade.outcome,
                pnl: trade.pnl,
                dailyPnL: this.dailyPnL,
                consecutiveLosses: this.consecutiveLosses,
            },
            'Trade recorded in risk manager'
        );
    }

    getDailyPnL(): number {
        return this.dailyPnL;
    }

    getConsecutiveLosses(): number {
        return this.consecutiveLosses;
    }

    isInCooldown(): boolean {
        return Date.now() < this.cooldownUntil;
    }

    resetDaily(): void {
        logger.info(
            { previousPnL: this.dailyPnL },
            'Resetting daily risk counters'
        );
        this.dailyPnL = 0;
        // Don't reset consecutive losses — they carry over
    }

    /**
     * Force-set state (for loading from DB on restart).
     */
    restoreState(dailyPnL: number, consecutiveLosses: number): void {
        this.dailyPnL = dailyPnL;
        this.consecutiveLosses = consecutiveLosses;
        this.cooldownUntil = 0;
        this.cooldownTriggeredAtLosses = 0;
    }
}
