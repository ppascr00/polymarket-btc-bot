// ============================================
// Polymarket BTC Bot - Strategy 4: Volatility Breakout
// ============================================
// Trend-following breakout strategy:
// - Trade only when range/volatility expands
// - Follow direction of short-term momentum

import type { Strategy, Signal, FeatureSet, MarketState } from '../types/index.js';

interface VolatilityBreakoutConfig {
    minEdge: number;
    minVolatility: number;
    minRange: number;
}

const DEFAULT_CONFIG: VolatilityBreakoutConfig = {
    minEdge: 0.02,
    minVolatility: 0.0015,
    minRange: 0.002,
};

export class VolatilityBreakoutStrategy implements Strategy {
    readonly name = 'volatility-breakout';
    private config: VolatilityBreakoutConfig;

    constructor(config: Partial<VolatilityBreakoutConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    compute(features: FeatureSet, marketState: MarketState): Signal {
        const reasons: string[] = [];
        const commission = 0.02;

        if (features.volatility < this.config.minVolatility) {
            reasons.push(`Volatility too low (${features.volatility.toFixed(4)})`);
            return this.noTrade(reasons);
        }

        if (features.rangeHL < this.config.minRange) {
            reasons.push(`Range too narrow (${(features.rangeHL * 100).toFixed(2)}%)`);
            return this.noTrade(reasons);
        }

        const momentumScore = features.ret1m * 0.6 + features.ret5m * 0.4;
        if (Math.abs(momentumScore) < 0.0005) {
            reasons.push('Momentum too weak for breakout');
            return this.noTrade(reasons);
        }

        const direction = momentumScore > 0 ? 'UP' : 'DOWN';
        const confidence = Math.min(1, Math.abs(momentumScore) * 180 + 0.25);
        const rawEdge = confidence * 0.14;
        const marketDrag = direction === 'UP'
            ? (marketState.yesPrice - 0.5)
            : (marketState.noPrice - 0.5);
        const edge = rawEdge - marketDrag - commission;

        reasons.push(`Breakout detected: vol=${features.volatility.toFixed(4)} range=${(features.rangeHL * 100).toFixed(2)}%`);
        reasons.push(`Momentum score=${momentumScore.toFixed(4)}`);

        if (edge < this.config.minEdge) {
            reasons.push(`Edge ${(edge * 100).toFixed(1)}% below threshold`);
            return this.noTrade(reasons);
        }

        reasons.push(`Edge ${(edge * 100).toFixed(1)}%`);
        return {
            direction,
            confidence,
            pUp: direction === 'UP' ? 0.5 + confidence * 0.3 : 0.5 - confidence * 0.3,
            edge,
            reasons,
            strategyName: this.name,
            timestamp: Date.now(),
        };
    }

    private noTrade(reasons: string[]): Signal {
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
}
