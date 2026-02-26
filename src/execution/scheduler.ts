// ============================================
// Polymarket BTC Bot — 5-Minute Window Scheduler
// ============================================
// Orchestrates the trading loop:
// 1. Wait for window alignment
// 2. Collect data + compute features
// 3. Run strategy at cutoff
// 4. Risk check
// 5. Execute (if allowed)
// 6. Resolve previous window

import { getLogger } from '../utils/logger.js';
import {
    getCurrentWindowStart,
    getCurrentWindowEnd,
    msUntilNextWindow,
    secondsIntoCurrentWindow,
    sleep,
    getUTCDayStart,
    formatUTC,
} from '../utils/time.js';
import { FeatureEngine } from '../data/feature-engine.js';
import { OHLCVAggregator } from '../data/ohlcv-aggregator.js';
import { Repository } from '../db/repository.js';
import { createStrategy, listStrategies } from '../strategy/registry.js';
import { getMinEdgeThresholdForStrategy } from '../risk/edge-threshold.js';
import type {
    BotConfig,
    Candle,
    FeatureSet,
    Signal,
    MarketState,
    AccountState,
    Strategy,
    RiskManager,
    ExecutionEngine,
    PolymarketClient,
    ExchangeDataProvider,
} from '../types/index.js';

const logger = getLogger();

export class Scheduler {
    private config: BotConfig;
    private repo: Repository;
    private exchange: ExchangeDataProvider;
    private polymarket: PolymarketClient;
    private strategy: Strategy;
    private riskManager: RiskManager;
    private executionEngine: ExecutionEngine;
    private featureEngine: FeatureEngine;
    private aggregator: OHLCVAggregator;

    private running = false;
    private paused = false;
    private consecutiveErrors = 0;
    private candleBuffer: Candle[] = [];
    private lastSignal: Signal | null = null;
    private lastStrategyName: string;
    private paperMultiEnabled = false;
    private paperStrategies: Map<string, Strategy> = new Map();
    private readonly paperStrategyInitialBalance = 100;
    private lastSingleRetrainAtMs = 0;
    private lastSingleRetrainFeatureCount = 0;
    private lastPaperMultiRetrainAtMs = 0;
    private lastPaperMultiRetrainFeatureCount = 0;
    private readonly retrainMinNewFeatures = 24;

    constructor(
        config: BotConfig,
        repo: Repository,
        exchange: ExchangeDataProvider,
        polymarket: PolymarketClient,
        strategy: Strategy,
        riskManager: RiskManager,
        executionEngine: ExecutionEngine
    ) {
        this.config = config;
        this.repo = repo;
        this.exchange = exchange;
        this.polymarket = polymarket;
        this.strategy = strategy;
        this.riskManager = riskManager;
        this.executionEngine = executionEngine;
        this.featureEngine = new FeatureEngine();
        this.aggregator = new OHLCVAggregator(config.timing.windowMinutes);
        this.lastStrategyName = strategy.name;
        this.lastSingleRetrainFeatureCount = this.repo.getAllFeatures().length;
    }

    async start(): Promise<void> {
        this.running = true;
        this.repo.setState('last_heartbeat', String(Date.now()));
        this.syncPausedStateFromDb();
        this.syncPaperMultiStateFromDb();
        logger.info(
            {
                mode: this.config.tradingMode,
                strategy: this.config.strategy,
                paperMultiEnabled: this.paperMultiEnabled,
                windowMinutes: this.config.timing.windowMinutes,
                cutoffSeconds: this.config.timing.tradingCutoffSeconds,
            },
            '🚀 Scheduler started'
        );

        // Register candle listener
        this.exchange.onCandle((candle) => {
            this.onNewCandle(candle);
        });

        // Main loop
        while (this.running) {
            try {
                await this.runWindowCycle();
            } catch (err) {
                this.consecutiveErrors++;
                this.repo.setState('consecutive_errors', String(this.consecutiveErrors));
                logger.error(
                    { err, consecutiveErrors: this.consecutiveErrors },
                    'Error in window cycle'
                );

                if (
                    this.config.featureFlags.autoPauseOnError &&
                    this.consecutiveErrors >= this.config.featureFlags.maxConsecutiveErrors
                ) {
                    this.paused = true;
                    this.repo.setState('paused', 'true');
                    logger.error(
                        { consecutiveErrors: this.consecutiveErrors },
                        '🛑 AUTO-PAUSED: Too many consecutive errors'
                    );
                    // Stay paused but keep running to allow recovery
                    await sleep(60_000); // Wait 1 min before retry
                    this.consecutiveErrors = 0;
                    this.repo.setState('consecutive_errors', '0');
                    this.paused = false;
                    this.repo.setState('paused', 'false');
                }
            }
        }
    }

    stop(): void {
        this.running = false;
        logger.info('Scheduler stopped');
    }

    private async runWindowCycle(): Promise<void> {
        this.repo.setState('last_heartbeat', String(Date.now()));
        this.syncPausedStateFromDb();
        this.syncPaperMultiStateFromDb();
        this.syncStrategyStateFromDb();

        const windowMinutes = this.config.timing.windowMinutes;
        const cutoffSeconds = this.config.timing.tradingCutoffSeconds;
        const windowStart = getCurrentWindowStart(windowMinutes);
        const windowEnd = getCurrentWindowEnd(windowMinutes);

        logger.info(
            {
                windowStart: formatUTC(windowStart),
                windowEnd: formatUTC(windowEnd),
                secondsInto: secondsIntoCurrentWindow(windowMinutes).toFixed(1),
            },
            '📊 Window cycle start'
        );

        // Wait until cutoff time within this window
        const secsIn = secondsIntoCurrentWindow(windowMinutes);
        if (secsIn < cutoffSeconds) {
            const waitMs = (cutoffSeconds - secsIn) * 1000;
            logger.info(
                { waitSeconds: (waitMs / 1000).toFixed(1) },
                'Waiting for trading cutoff...'
            );
            await sleep(waitMs);
        }

        // Check if paused
        if (this.paused) {
            logger.warn('Scheduler is PAUSED. Skipping trade decision.');
            await this.waitForNextWindow();
            return;
        }

        // Check data freshness
        const dataLatency = this.exchange.getLatency();
        if (dataLatency > this.config.timing.dataStaleTresholdSeconds * 1000) {
            logger.warn(
                { latencyMs: dataLatency },
                'Data is STALE. Skipping trade.'
            );
            if (this.config.featureFlags.autoPauseOnStaleData) {
                this.paused = true;
                this.repo.setState('paused', 'true');
                logger.error('🛑 AUTO-PAUSED: Stale data detected');
            }
            await this.waitForNextWindow();
            return;
        }

        // Check if already traded this window
        if (!this.paperMultiEnabled && this.repo.hasTradeForWindow(windowStart)) {
            logger.info('Already traded in this window. Waiting for next.');
            await this.waitForNextWindow();
            return;
        }

        // Get the previously completed window to compute features
        const prevWindowStart = windowStart - windowMinutes * 60 * 1000;

        // Get lookback candles from DB (20 mins before prevWindowStart)
        const lookbackStart = prevWindowStart - 20 * 60 * 1000;
        const lookbackCandles = this.repo.getCandles(lookbackStart, prevWindowStart);

        // The most recently completed window candles
        const windowCandles = this.repo.getCandles(prevWindowStart, windowStart);

        if (windowCandles.length === 0) {
            logger.warn('No candles available for previous window. Skipping.');
            await this.waitForNextWindow();
            return;
        }

        // Compute features
        const features = this.featureEngine.compute(
            windowCandles,
            lookbackCandles,
            0, // TODO: get real-time orderbook imbalance from exchange
            0,
            0
        );

        // Save features
        this.repo.insertFeatures(features);
        this.maybeRetrainActiveStrategy();

        // Get market state
        let marketState: MarketState;
        try {
            marketState = await this.getMarketState();
        } catch (err) {
            logger.error({ err }, 'Failed to get market state. Skipping trade.');
            await this.waitForNextWindow();
            return;
        }

        if (this.paperMultiEnabled) {
            await this.runPaperMultiCycle(windowStart, features, marketState);

            // Reset error counter on successful cycle
            this.consecutiveErrors = 0;
            this.repo.setState('consecutive_errors', '0');

            await this.waitForNextWindow();
            await this.resolvePendingTrades(windowStart);
            return;
        }

        // Run strategy
        const signal = this.strategy.compute(features, marketState);
        this.lastSignal = signal;
        this.repo.setState('last_signal', JSON.stringify(signal));

        logger.info(
            {
                direction: signal.direction,
                confidence: signal.confidence.toFixed(3),
                pUp: signal.pUp.toFixed(3),
                edge: (signal.edge * 100).toFixed(1) + '%',
                reasons: signal.reasons.slice(0, 3),
            },
            '🎯 Signal generated'
        );

        // Risk check
        const accountState: AccountState = {
            balance: 100, // TODO: get real balance
            dailyPnL: this.riskManager.getDailyPnL(),
            openPositions: 0,
            consecutiveLosses: this.riskManager.getConsecutiveLosses(),
            tradesThisWindow: this.repo.hasTradeForWindow(windowStart) ? 1 : 0,
        };

        const riskDecision = this.riskManager.canTrade(signal, accountState);

        if (!riskDecision.allowed) {
            logger.info(
                { reason: riskDecision.reason },
                '⛔ Risk check: trade NOT allowed'
            );
            await this.waitForNextWindow();
            return;
        }

        // Execute trade
        const stake = riskDecision.adjustedStake ?? this.config.risk.maxStakePerTrade;

        logger.info(
            { stake, direction: signal.direction },
            '✅ Executing trade'
        );

        const trade = await this.executionEngine.execute(signal, marketState, stake, features.close);
        trade.windowStart = windowStart;

        // Save trade
        const tradeId = this.repo.insertTrade(trade);

        // Reset error counter on success
        this.consecutiveErrors = 0;
        this.repo.setState('consecutive_errors', '0');

        // Resolve: in PAPER mode, simulate outcome based on next window's price
        // (This will be done when the next candle arrives or at next cycle)
        this.repo.setState('last_trade_id', String(tradeId));
        this.repo.setState('last_trade_window', String(windowStart));

        // Wait for next window
        await this.waitForNextWindow();

        // After window ends, resolve the trade
        await this.resolvePendingTrades(windowStart);
    }

    private async resolvePendingTrades(previousWindowStart: number): Promise<void> {
        const pendingTrades = this.repo.getPendingTrades();

        for (const trade of pendingTrades) {
            // Resolve trades as soon as their 5m window has just finished.
            // Example: a trade opened at 20:35 is eligible when resolving at ~20:40.
            if (trade.windowStart > previousWindowStart) continue; // too recent

            // Get the candle data after the window to determine outcome
            const windowEnd = trade.windowStart + this.config.timing.windowMinutes * 60 * 1000;
            const nextCandles = this.repo.getCandles(trade.windowStart, windowEnd);

            if (nextCandles.length < 2) continue; // not enough data yet

            const firstCandle = nextCandles[0]!;
            const lastCandle = nextCandles[nextCandles.length - 1]!;
            const priceWentUp = lastCandle.close > firstCandle.open;

            const isCorrect =
                (trade.direction === 'UP' && priceWentUp) ||
                (trade.direction === 'DOWN' && !priceWentUp);

            const outcome = isCorrect ? 'WIN' : 'LOSS';
            // Simplified P&L: win = stake * (1/price - 1), loss = -stake
            const pnl = isCorrect
                ? trade.stake * (1 / trade.entryPrice - 1)
                : -trade.stake;

            if (trade.id !== undefined) {
                const btcPriceClose = lastCandle.close;
                this.repo.updateTradeOutcome(trade.id, outcome, pnl, btcPriceClose);
                if (!this.paperMultiEnabled) {
                    this.riskManager.recordTrade({ ...trade, outcome, pnl, btcPriceClose });
                }

                logger.info(
                    {
                        tradeId: trade.id,
                        outcome,
                        pnl: pnl.toFixed(2),
                        direction: trade.direction,
                        priceWentUp,
                        btcPriceEntry: trade.btcPriceEntry,
                        btcPriceClose,
                    },
                    outcome === 'WIN' ? '🟢 Trade resolved: WIN' : '🔴 Trade resolved: LOSS'
                );
            }
        }
    }

    private async getMarketState(): Promise<MarketState> {
        const market = await this.polymarket.findMarket(
            this.config.polymarket.marketSlug
        );

        if (!market || !market.active) {
            throw new Error('BTC 5m Up/Down market not found or not active');
        }

        const [yesOb, noOb] = await Promise.all([
            this.polymarket.getOrderbook(market.yesTokenId),
            this.polymarket.getOrderbook(market.noTokenId),
        ]);

        return {
            market,
            yesOrderbook: yesOb,
            noOrderbook: noOb,
            yesPrice: yesOb.midPrice,
            noPrice: noOb.midPrice,
            impliedProbUp: yesOb.midPrice,
        };
    }

    private async runPaperMultiCycle(
        windowStart: number,
        features: FeatureSet,
        marketState: MarketState
    ): Promise<void> {
        this.ensurePaperStrategiesLoaded();
        this.maybeRetrainPaperStrategies();

        const strategyNames = Array.from(this.paperStrategies.keys());
        const focusStrategyName = this.repo.getState('strategy_active') || this.lastStrategyName;
        let firstSignal: Signal | null = null;
        let focusedSignal: Signal | null = null;

        for (const strategyName of strategyNames) {
            const strategy = this.paperStrategies.get(strategyName);
            if (!strategy) continue;

            const signal = strategy.compute(features, marketState);
            firstSignal = firstSignal ?? signal;

            this.repo.setState(`last_signal_${strategyName}`, JSON.stringify(signal));
            if (strategyName === focusStrategyName) {
                focusedSignal = signal;
            }

            let shouldTrade = false;
            let tradeId: number | null = null;
            let decisionReason = 'Strategy says NO_TRADE';
            let stake = 0;

            if (signal.direction !== 'NO_TRADE') {
                const effectiveMinEdge = getMinEdgeThresholdForStrategy(
                    strategyName,
                    this.config.risk.minEdgeThreshold
                );
                if (this.repo.hasTradeForWindowByStrategy(windowStart, strategyName)) {
                    decisionReason = 'Already traded in this window for strategy';
                } else if (signal.edge < effectiveMinEdge) {
                    decisionReason = `Edge ${(signal.edge * 100).toFixed(1)}% < threshold ${(effectiveMinEdge * 100).toFixed(1)}%`;
                } else {
                    const closedPnl = this.repo.getClosedPnlByModeAndStrategy('PAPER', strategyName);
                    const virtualBalance = this.paperStrategyInitialBalance + closedPnl;
                    stake = this.getStakeByConfidence(
                        this.config.risk.maxStakePerTrade,
                        signal.confidence
                    );

                    if (virtualBalance <= 0) {
                        decisionReason = 'No virtual balance for this strategy';
                    } else {
                        stake = Math.min(stake, virtualBalance);
                        if (stake <= 0) {
                            decisionReason = 'No virtual balance for this strategy';
                        } else {
                            shouldTrade = true;
                            decisionReason = 'All checks passed';
                        }
                    }
                }
            }

            if (shouldTrade) {
                const trade = await this.executionEngine.execute(
                    signal,
                    marketState,
                    stake,
                    features.close
                );
                trade.windowStart = windowStart;
                tradeId = this.repo.insertTrade(trade);
                this.repo.setState(`last_trade_id_${strategyName}`, String(tradeId));
                this.repo.setState(`last_trade_window_${strategyName}`, String(windowStart));
            }

            this.repo.insertStrategyWindowSignal({
                timestamp: signal.timestamp,
                windowStart,
                mode: 'PAPER',
                strategy: strategyName,
                direction: signal.direction,
                confidence: signal.confidence,
                pUp: signal.pUp,
                edge: signal.edge,
                shouldTrade,
                decisionReason,
                reasons: signal.reasons,
                tradeId,
            });

            logger.info(
                {
                    strategy: strategyName,
                    direction: signal.direction,
                    confidence: signal.confidence.toFixed(3),
                    edge: (signal.edge * 100).toFixed(1) + '%',
                    shouldTrade,
                    reason: decisionReason,
                    stake: shouldTrade ? stake : 0,
                },
                shouldTrade ? '✅ Multi: trade executed' : '⛔ Multi: trade skipped'
            );
        }

        const nextLastSignal = focusedSignal ?? firstSignal;
        if (nextLastSignal) {
            this.lastSignal = nextLastSignal;
            this.repo.setState('last_signal', JSON.stringify(nextLastSignal));
            this.lastStrategyName = nextLastSignal.strategyName;
        }
    }

    private onNewCandle(candle: Candle): void {
        this.repo.setState('last_heartbeat', String(Date.now()));

        // Save to DB
        this.repo.insertCandle(candle);
        this.candleBuffer.push(candle);

        // Keep buffer manageable
        if (this.candleBuffer.length > 100) {
            this.candleBuffer = this.candleBuffer.slice(-50);
        }

        logger.debug(
            { ts: formatUTC(candle.timestamp), close: candle.close },
            'Candle saved'
        );
    }

    private ensurePaperStrategiesLoaded(): void {
        if (this.paperStrategies.size > 0) return;

        const historicalFeatures = this.repo.getAllFeatures();
        for (const strategyName of listStrategies()) {
            const strategy = createStrategy(strategyName);
            if (historicalFeatures.length > 20 && strategy.train) {
                strategy.train(historicalFeatures);
            }
            this.paperStrategies.set(strategyName, strategy);
        }

        logger.info(
            { strategies: Array.from(this.paperStrategies.keys()) },
            'Paper multi strategies loaded'
        );
        this.lastPaperMultiRetrainAtMs = Date.now();
        this.lastPaperMultiRetrainFeatureCount = historicalFeatures.length;
    }

    private getRetrainIntervalMs(): number {
        return this.config.tradingMode === 'PAPER'
            ? 15 * 60 * 1000
            : 60 * 60 * 1000;
    }

    private maybeRetrainActiveStrategy(): void {
        if (!this.strategy.train) return;

        const now = Date.now();
        const intervalMs = this.getRetrainIntervalMs();
        if (
            this.lastSingleRetrainAtMs > 0 &&
            now - this.lastSingleRetrainAtMs < intervalMs
        ) {
            return;
        }

        const historicalFeatures = this.repo.getAllFeatures();
        const featureCount = historicalFeatures.length;
        const newFeatures = featureCount - this.lastSingleRetrainFeatureCount;
        if (
            this.lastSingleRetrainAtMs > 0 &&
            newFeatures < this.retrainMinNewFeatures
        ) {
            return;
        }

        if (featureCount < 25) return;

        this.strategy.train(historicalFeatures);
        this.lastSingleRetrainAtMs = now;
        this.lastSingleRetrainFeatureCount = featureCount;
        logger.info(
            {
                strategy: this.strategy.name,
                mode: this.config.tradingMode,
                featureCount,
                newFeatures,
                retrainIntervalMinutes: Math.round(intervalMs / 60_000),
            },
            'Strategy retrained (scheduled)'
        );
    }

    private maybeRetrainPaperStrategies(): void {
        if (this.paperStrategies.size === 0) return;

        const now = Date.now();
        const intervalMs = this.getRetrainIntervalMs();
        if (
            this.lastPaperMultiRetrainAtMs > 0 &&
            now - this.lastPaperMultiRetrainAtMs < intervalMs
        ) {
            return;
        }

        const historicalFeatures = this.repo.getAllFeatures();
        const featureCount = historicalFeatures.length;
        const newFeatures = featureCount - this.lastPaperMultiRetrainFeatureCount;
        if (
            this.lastPaperMultiRetrainAtMs > 0 &&
            newFeatures < this.retrainMinNewFeatures
        ) {
            return;
        }

        if (featureCount < 25) return;

        let retrainedCount = 0;
        for (const [strategyName, strategy] of this.paperStrategies.entries()) {
            if (!strategy.train) continue;
            strategy.train(historicalFeatures);
            retrainedCount++;
            logger.info({ strategy: strategyName, featureCount }, 'Paper multi strategy retrained');
        }

        if (retrainedCount > 0) {
            this.lastPaperMultiRetrainAtMs = now;
            this.lastPaperMultiRetrainFeatureCount = featureCount;
            logger.info(
                {
                    mode: this.config.tradingMode,
                    retrainedCount,
                    featureCount,
                    newFeatures,
                    retrainIntervalMinutes: Math.round(intervalMs / 60_000),
                },
                'Paper multi retraining cycle completed'
            );
        }
    }

    private getStakeByConfidence(baseStake: number, confidence: number): number {
        let stake = baseStake;
        if (confidence < 0.3) {
            stake *= 0.5;
        } else if (confidence < 0.5) {
            stake *= 0.75;
        }
        return stake;
    }

    private async waitForNextWindow(): Promise<void> {
        const waitMs = msUntilNextWindow(this.config.timing.windowMinutes);
        logger.info(
            { waitSeconds: (waitMs / 1000).toFixed(0) },
            '⏳ Waiting for next window'
        );
        await sleep(waitMs + 500); // small buffer
    }

    // --- Public getters for dashboard ---
    getLastSignal(): Signal | null {
        return this.lastSignal;
    }

    isPaused(): boolean {
        return this.paused;
    }

    isRunning(): boolean {
        return this.running;
    }

    getConsecutiveErrors(): number {
        return this.consecutiveErrors;
    }

    isPaperMultiEnabled(): boolean {
        return this.paperMultiEnabled;
    }

    setPaused(paused: boolean): void {
        this.paused = paused;
        this.repo.setState('paused', String(paused));
        logger.info({ paused }, paused ? '⏸ Scheduler paused' : '▶ Scheduler resumed');
    }

    private syncPausedStateFromDb(): void {
        const pausedFromDb = this.repo.getState('paused');
        if (pausedFromDb === null) {
            this.repo.setState('paused', String(this.paused));
            return;
        }

        const nextPaused = pausedFromDb === 'true';
        if (nextPaused !== this.paused) {
            this.paused = nextPaused;
            logger.info({ paused: this.paused }, 'Scheduler pause state updated from DB');
        }
    }

    private syncPaperMultiStateFromDb(): void {
        const raw = this.repo.getState('paper_multi_enabled');
        const envDefault = process.env.PAPER_MULTI === 'true';
        if (raw === null) {
            this.repo.setState('paper_multi_enabled', String(envDefault));
        }

        const requested = raw === null ? envDefault : raw === 'true';
        const nextEnabled = this.config.tradingMode === 'PAPER' && requested;
        if (nextEnabled !== this.paperMultiEnabled) {
            this.paperMultiEnabled = nextEnabled;
            if (this.paperMultiEnabled) {
                this.ensurePaperStrategiesLoaded();
            }
            logger.info(
                { paperMultiEnabled: this.paperMultiEnabled },
                'Paper multi state updated from DB'
            );
        }
    }

    private syncStrategyStateFromDb(): void {
        const strategyFromDb = this.repo.getState('strategy_active');
        if (!strategyFromDb || strategyFromDb === this.lastStrategyName) {
            return;
        }

        if (!listStrategies().includes(strategyFromDb)) {
            logger.warn({ strategyFromDb }, 'Ignoring unknown strategy from DB');
            this.repo.setState('strategy_active', this.lastStrategyName);
            return;
        }

        const nextStrategy = createStrategy(strategyFromDb);
        const historicalFeatures = this.repo.getAllFeatures();
        if (historicalFeatures.length > 20 && nextStrategy.train) {
            nextStrategy.train(historicalFeatures);
            this.lastSingleRetrainAtMs = Date.now();
            this.lastSingleRetrainFeatureCount = historicalFeatures.length;
        }

        this.strategy = nextStrategy;
        this.lastStrategyName = nextStrategy.name;
        logger.info({ strategy: this.lastStrategyName }, 'Strategy switched from DB state');
    }
}
