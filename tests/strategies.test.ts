// ============================================
// Tests — Strategies
// ============================================

import { describe, it, expect } from 'vitest';
import { ProbabilisticStrategy } from '../src/strategy/probabilistic.js';
import { EmaCrossoverStrategy } from '../src/strategy/ema-crossover.js';
import { RsiReversionStrategy } from '../src/strategy/rsi-reversion.js';
import { VolatilityBreakoutStrategy } from '../src/strategy/volatility-breakout.js';
import { createStrategy, listStrategies } from '../src/strategy/registry.js';
import type { FeatureSet, MarketState, Orderbook, PolymarketMarket } from '../src/types/index.js';

function makeFeatures(overrides: Partial<FeatureSet> = {}): FeatureSet {
    return {
        windowStart: 1700000000000,
        windowEnd: 1700000300000,
        open: 43000,
        close: 43100,
        ret1m: 0.001,
        ret5m: 0.0023,
        ema3: 43080,
        ema8: 43020,
        rsi14: 55,
        volatility: 0.002,
        rangeHL: 0.003,
        volume: 500,
        obImbalance: 0.1,
        spread: 0.02,
        midChange: 0.001,
        ...overrides,
    };
}

function makeMarketState(yesPrice: number = 0.50): MarketState {
    const mockOb = (price: number): Orderbook => ({
        bids: [{ price: price - 0.01, size: 100 }],
        asks: [{ price: price + 0.01, size: 100 }],
        midPrice: price,
        spread: 0.02,
        timestamp: Date.now(),
    });

    const market: PolymarketMarket = {
        conditionId: 'test',
        slug: 'test',
        question: 'Test?',
        yesTokenId: 'yes-token',
        noTokenId: 'no-token',
        active: true,
        endDate: '',
    };

    return {
        market,
        yesOrderbook: mockOb(yesPrice),
        noOrderbook: mockOb(1 - yesPrice),
        yesPrice,
        noPrice: 1 - yesPrice,
        impliedProbUp: yesPrice,
    };
}

describe('Probabilistic Strategy', () => {
    it('returns a signal with valid structure', () => {
        const strat = new ProbabilisticStrategy(0.02);
        const signal = strat.compute(makeFeatures(), makeMarketState());

        expect(signal.strategyName).toBe('probabilistic');
        expect(signal.pUp).toBeGreaterThan(0);
        expect(signal.pUp).toBeLessThan(1);
        expect(signal.reasons.length).toBeGreaterThan(0);
        expect(['UP', 'DOWN', 'NO_TRADE']).toContain(signal.direction);
    });

    it('returns NO_TRADE when edge is insufficient', () => {
        const strat = new ProbabilisticStrategy(0.5); // very high threshold
        const signal = strat.compute(makeFeatures(), makeMarketState());
        expect(signal.direction).toBe('NO_TRADE');
    });

    it('can be trained', () => {
        const strat = new ProbabilisticStrategy();
        const trainingData = Array.from({ length: 30 }, (_, i) => {
            const isUp = i % 2 === 0;
            return makeFeatures({
                windowStart: 1700000000000 + i * 300000,
                open: 43000,
                close: isUp ? 43100 : 42900,
                ret5m: isUp ? 0.002 : -0.002,
            });
        });

        expect(() => strat.train!(trainingData)).not.toThrow();
    });
});

describe('EMA Crossover Strategy', () => {
    it('returns UP signal when EMA3 > EMA8', () => {
        const strat = new EmaCrossoverStrategy({ minEdge: 0.0 });
        const features = makeFeatures({
            ema3: 43100,
            ema8: 43000,
            rsi14: 55,
            volatility: 0.005,
            rangeHL: 0.002,
        });
        const signal = strat.compute(features, makeMarketState());

        expect(signal.direction).toBe('UP');
        expect(signal.strategyName).toBe('ema-crossover');
    });

    it('returns DOWN signal when EMA3 < EMA8', () => {
        const strat = new EmaCrossoverStrategy({ minEdge: 0.0 });
        const features = makeFeatures({
            ema3: 42900,
            ema8: 43000,
            rsi14: 45,
            volatility: 0.005,
            rangeHL: 0.002,
        });
        const signal = strat.compute(features, makeMarketState());
        expect(signal.direction).toBe('DOWN');
    });

    it('returns NO_TRADE when RSI conflicts with EMA', () => {
        const strat = new EmaCrossoverStrategy();
        const features = makeFeatures({
            ema3: 43100,   // bullish EMA
            ema8: 43000,
            rsi14: 75,      // overbought → conflicts
            volatility: 0.005,
            rangeHL: 0.002,
        });
        const signal = strat.compute(features, makeMarketState());
        expect(signal.direction).toBe('NO_TRADE');
    });

    it('returns NO_TRADE when volatility is too low', () => {
        const strat = new EmaCrossoverStrategy();
        const features = makeFeatures({
            ema3: 43100,
            ema8: 43000,
            volatility: 0.00001, // too low
            rangeHL: 0.002,
        });
        const signal = strat.compute(features, makeMarketState());
        expect(signal.direction).toBe('NO_TRADE');
    });
});

describe('Strategy Registry', () => {
    it('lists available strategies', () => {
        const names = listStrategies();
        expect(names).toContain('probabilistic');
        expect(names).toContain('ema-crossover');
        expect(names).toContain('rsi-reversion');
        expect(names).toContain('volatility-breakout');
    });

    it('creates strategies by name', () => {
        const s1 = createStrategy('probabilistic');
        expect(s1.name).toBe('probabilistic');

        const s2 = createStrategy('ema-crossover');
        expect(s2.name).toBe('ema-crossover');

        const s3 = createStrategy('rsi-reversion');
        expect(s3.name).toBe('rsi-reversion');

        const s4 = createStrategy('volatility-breakout');
        expect(s4.name).toBe('volatility-breakout');
    });

    it('throws for unknown strategy', () => {
        expect(() => createStrategy('nonexistent')).toThrow('Unknown strategy');
    });
});

describe('Additional Strategies', () => {
    it('rsi reversion returns a valid signal', () => {
        const strat = new RsiReversionStrategy();
        const signal = strat.compute(makeFeatures({ rsi14: 25, ret1m: -0.001, ret5m: -0.0015 }), makeMarketState());
        expect(['UP', 'DOWN', 'NO_TRADE']).toContain(signal.direction);
    });

    it('volatility breakout returns a valid signal', () => {
        const strat = new VolatilityBreakoutStrategy();
        const signal = strat.compute(
            makeFeatures({ volatility: 0.004, rangeHL: 0.004, ret1m: 0.0015, ret5m: 0.002 }),
            makeMarketState()
        );
        expect(['UP', 'DOWN', 'NO_TRADE']).toContain(signal.direction);
    });
});
