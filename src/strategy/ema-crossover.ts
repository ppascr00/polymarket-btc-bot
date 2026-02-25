// ============================================
// Polymarket BTC Bot — Strategy 2: EMA Crossover
// ============================================
// Deterministic rule-based strategy.
// Signal: EMA(3) crosses above/below EMA(8)
// Filters: RSI extremes, volatility band, range expansion
// If conflicting signals: NO_TRADE.

import { getLogger } from '../utils/logger.js';
import type { Strategy, Signal, FeatureSet, MarketState } from '../types/index.js';

const logger = getLogger();

interface EmaCrossoverConfig {
    minEdge: number;
    rsiOverbought: number;
    rsiOversold: number;
    minVolatility: number;
    maxVolatility: number;
    minRangeExpansion: number;
    momentumScale: number;
    paperCommission: number;
    liveCommission: number;
}

const DEFAULT_CONFIG: EmaCrossoverConfig = {
    minEdge: 0.003,
    rsiOverbought: 68,
    rsiOversold: 32,
    minVolatility: 0.0001,  // minimum vol to trade (avoid dead markets)
    maxVolatility: 0.02,    // max vol (avoid extreme chaos)
    minRangeExpansion: 0.00015, // minimum high-low range relative to open
    momentumScale: 35,
    paperCommission: 0.005,
    liveCommission: 0.02,
};

/**
 * Strategy 2: EMA Crossover with RSI + Volatility filters.
 *
 * Rules:
 * - BULLISH: EMA(3) > EMA(8), RSI not overbought, vol in band
 * - BEARISH: EMA(3) < EMA(8), RSI not oversold, vol in band
 * - NO_TRADE: conflicting signals, vol out of band, or RSI extreme
 *
 * Edge is estimated as: |EMA3 - EMA8| / EMA8 (normalized momentum)
 * compared against market price spread.
 */
export class EmaCrossoverStrategy implements Strategy {
    readonly name = 'ema-crossover';
    private config: EmaCrossoverConfig;

    constructor(config: Partial<EmaCrossoverConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    private getCommission(): number {
        return process.env.TRADING_MODE === 'PAPER'
            ? this.config.paperCommission
            : this.config.liveCommission;
    }

    compute(features: FeatureSet, marketState: MarketState): Signal {
        const reasons: string[] = [];
        let score = 0; // positive = UP, negative = DOWN
        let conflicting = false;

        // --- Signal 1: EMA Crossover ---
        const emaDiff = features.ema3 - features.ema8;
        const emaCrossUp = emaDiff > 0;
        const emaCrossDown = emaDiff < 0;

        if (emaCrossUp) {
            score += 1;
            reasons.push(`EMA(3)=${features.ema3.toFixed(2)} > EMA(8)=${features.ema8.toFixed(2)} → BULLISH`);
        } else if (emaCrossDown) {
            score -= 1;
            reasons.push(`EMA(3)=${features.ema3.toFixed(2)} < EMA(8)=${features.ema8.toFixed(2)} → BEARISH`);
        }

        // --- Signal 2: RSI Confirmation ---
        const rsiVal = features.rsi14;

        if (rsiVal > this.config.rsiOverbought) {
            // Overbought: contradicts bullish, confirms bearish
            if (emaCrossUp) {
                conflicting = true;
                reasons.push(`RSI=${rsiVal.toFixed(1)} OVERBOUGHT → conflicts with EMA bullish`);
            } else {
                score -= 0.5;
                reasons.push(`RSI=${rsiVal.toFixed(1)} OVERBOUGHT → confirms bearish`);
            }
        } else if (rsiVal < this.config.rsiOversold) {
            // Oversold: contradicts bearish, confirms bullish
            if (emaCrossDown) {
                conflicting = true;
                reasons.push(`RSI=${rsiVal.toFixed(1)} OVERSOLD → conflicts with EMA bearish`);
            } else {
                score += 0.5;
                reasons.push(`RSI=${rsiVal.toFixed(1)} OVERSOLD → confirms bullish`);
            }
        } else {
            reasons.push(`RSI=${rsiVal.toFixed(1)} NEUTRAL`);
        }

        // --- Filter: Volatility Band ---
        const vol = features.volatility;
        let volOk = true;

        if (vol < this.config.minVolatility) {
            volOk = false;
            reasons.push(`Volatility=${vol.toFixed(6)} TOO LOW (min=${this.config.minVolatility})`);
        } else if (vol > this.config.maxVolatility) {
            volOk = false;
            reasons.push(`Volatility=${vol.toFixed(6)} TOO HIGH (max=${this.config.maxVolatility})`);
        }

        // --- Filter: Range Expansion ---
        const rangeOk = features.rangeHL >= this.config.minRangeExpansion;
        if (!rangeOk) {
            reasons.push(`Range=${features.rangeHL.toFixed(6)} too narrow (min=${this.config.minRangeExpansion})`);
        }

        // --- Final Decision ---
        let direction: 'UP' | 'DOWN' | 'NO_TRADE' = 'NO_TRADE';
        let confidence = 0;
        let edge = 0;
        const momentum = features.ema8 > 0 ? Math.abs(emaDiff) / features.ema8 : 0;
        const commission = this.getCommission();

        if (conflicting || !volOk || !rangeOk) {
            direction = 'NO_TRADE';
            reasons.push('→ NO TRADE: filters not passed');
        } else if (score > 0) {
            direction = 'UP';
            // Estimate edge based on EMA momentum vs market price
            edge = momentum * this.config.momentumScale;
            const marketEdge = edge - (marketState.yesPrice - 0.5) - commission;
            edge = Math.max(0, marketEdge);
            confidence = Math.min(1, Math.abs(score) / 2);
            reasons.push(`→ UP (score=${score.toFixed(2)}, edge=${(edge * 100).toFixed(1)}%)`);
        } else if (score < 0) {
            direction = 'DOWN';
            edge = momentum * this.config.momentumScale;
            const marketEdge = edge - (marketState.noPrice - 0.5) - commission;
            edge = Math.max(0, marketEdge);
            confidence = Math.min(1, Math.abs(score) / 2);
            reasons.push(`→ DOWN (score=${score.toFixed(2)}, edge=${(edge * 100).toFixed(1)}%)`);
        } else {
            reasons.push('→ NO TRADE: neutral score');
        }

        // Check minimum edge
        if (direction !== 'NO_TRADE' && edge < this.config.minEdge) {
            reasons.push(`Edge ${(edge * 100).toFixed(1)}% < threshold ${(this.config.minEdge * 100).toFixed(1)}% → NO TRADE`);
            direction = 'NO_TRADE';
            edge = 0;
            confidence = 0;
        }

        // Estimate pUp
        const pUp = direction === 'UP' ? 0.5 + confidence * 0.3 :
            direction === 'DOWN' ? 0.5 - confidence * 0.3 : 0.5;

        return {
            direction,
            confidence,
            pUp,
            edge,
            reasons,
            strategyName: this.name,
            timestamp: Date.now(),
        };
    }
}
