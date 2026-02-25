// ============================================
// Polymarket BTC Bot - Strategy 3: RSI Reversion
// ============================================
// Mean-reversion strategy:
// - If RSI is oversold and momentum stabilizes, look for UP
// - If RSI is overbought and momentum weakens, look for DOWN

import type { Strategy, Signal, FeatureSet, MarketState } from '../types/index.js';

interface RsiReversionConfig {
    minEdge: number;
    oversold: number;
    overbought: number;
}

const DEFAULT_CONFIG: RsiReversionConfig = {
    minEdge: 0.02,
    oversold: 30,
    overbought: 70,
};

export class RsiReversionStrategy implements Strategy {
    readonly name = 'rsi-reversion';
    private config: RsiReversionConfig;

    constructor(config: Partial<RsiReversionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    compute(features: FeatureSet, marketState: MarketState): Signal {
        const reasons: string[] = [];
        const commission = 0.02;
        let direction: 'UP' | 'DOWN' | 'NO_TRADE' = 'NO_TRADE';
        let confidence = 0;
        let edge = 0;

        const rsi = features.rsi14;
        const momentum = features.ret1m + features.ret5m;

        // Oversold with easing downside momentum -> probable rebound.
        if (rsi <= this.config.oversold && momentum > -0.004) {
            direction = 'UP';
            confidence = Math.min(1, (this.config.oversold - rsi) / 20 + 0.35);
            edge = confidence * 0.15 - (marketState.yesPrice - 0.5) - commission;
            reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
            reasons.push(`Momentum stabilizing (${(momentum * 100).toFixed(2)}%)`);
        }

        // Overbought with easing upside momentum -> probable pullback.
        if (rsi >= this.config.overbought && momentum < 0.004) {
            const downConfidence = Math.min(1, (rsi - this.config.overbought) / 20 + 0.35);
            const downEdge = downConfidence * 0.15 - (marketState.noPrice - 0.5) - commission;

            if (downEdge > edge) {
                direction = 'DOWN';
                confidence = downConfidence;
                edge = downEdge;
            }

            reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
            reasons.push(`Momentum fading (${(momentum * 100).toFixed(2)}%)`);
        }

        if (direction === 'NO_TRADE') {
            reasons.push('No RSI mean-reversion setup');
            return {
                direction,
                confidence: 0,
                pUp: 0.5,
                edge: 0,
                reasons,
                strategyName: this.name,
                timestamp: Date.now(),
            };
        }

        if (edge < this.config.minEdge) {
            reasons.push(`Edge ${(edge * 100).toFixed(1)}% below threshold`);
            return {
                direction: 'NO_TRADE',
                confidence: 0,
                pUp: 0.5,
                edge: 0,
                reasons,
                strategyName: this.name,
                timestamp: Date.now(),
            };
        }

        reasons.push(`Edge ${(edge * 100).toFixed(1)}%`);
        return {
            direction,
            confidence,
            pUp: direction === 'UP' ? 0.5 + confidence * 0.25 : 0.5 - confidence * 0.25,
            edge,
            reasons,
            strategyName: this.name,
            timestamp: Date.now(),
        };
    }
}
