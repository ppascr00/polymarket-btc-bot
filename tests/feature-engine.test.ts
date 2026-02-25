// ============================================
// Tests — Feature Engine
// ============================================

import { describe, it, expect } from 'vitest';
import { ema, emaSeries, rsi, realizedVolatility, simpleReturn, sigmoid, maxDrawdown, profitFactor, sharpeRatio } from '../src/utils/math.js';
import { FeatureEngine } from '../src/data/feature-engine.js';
import type { Candle } from '../src/types/index.js';

describe('Math Utilities', () => {
    describe('EMA', () => {
        it('returns single value for single input', () => {
            expect(ema([100], 3)).toBe(100);
        });

        it('computes EMA correctly', () => {
            const values = [10, 12, 14, 13, 15];
            const result = ema(values, 3);
            // EMA(3) with k=0.5
            expect(result).toBeGreaterThan(13);
            expect(result).toBeLessThan(16);
        });

        it('EMA series has same length as input', () => {
            const values = [1, 2, 3, 4, 5];
            const series = emaSeries(values, 3);
            expect(series).toHaveLength(5);
        });
    });

    describe('RSI', () => {
        it('returns 50 for insufficient data', () => {
            expect(rsi([100, 101, 102], 14)).toBe(50);
        });

        it('returns high RSI for uptrend', () => {
            const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
            const result = rsi(closes, 14);
            expect(result).toBeGreaterThan(70);
        });

        it('returns low RSI for downtrend', () => {
            const closes = Array.from({ length: 20 }, (_, i) => 200 - i);
            const result = rsi(closes, 14);
            expect(result).toBeLessThan(30);
        });
    });

    describe('Realized Volatility', () => {
        it('returns 0 for single value', () => {
            expect(realizedVolatility([100])).toBe(0);
        });

        it('returns 0 for constant prices', () => {
            expect(realizedVolatility([100, 100, 100, 100])).toBe(0);
        });

        it('returns positive for varying prices', () => {
            expect(realizedVolatility([100, 102, 98, 103, 97])).toBeGreaterThan(0);
        });
    });

    describe('Simple Return', () => {
        it('computes positive return', () => {
            expect(simpleReturn(100, 110)).toBeCloseTo(0.1);
        });

        it('computes negative return', () => {
            expect(simpleReturn(100, 90)).toBeCloseTo(-0.1);
        });

        it('handles zero from', () => {
            expect(simpleReturn(0, 100)).toBe(0);
        });
    });

    describe('Sigmoid', () => {
        it('returns 0.5 for 0', () => {
            expect(sigmoid(0)).toBeCloseTo(0.5);
        });

        it('returns ~1 for large positive', () => {
            expect(sigmoid(10)).toBeGreaterThan(0.99);
        });

        it('returns ~0 for large negative', () => {
            expect(sigmoid(-10)).toBeLessThan(0.01);
        });
    });

    describe('Max Drawdown', () => {
        it('returns 0 for empty array', () => {
            const { maxDD } = maxDrawdown([]);
            expect(maxDD).toBe(0);
        });

        it('computes drawdown correctly', () => {
            const equity = [100, 105, 103, 108, 95, 110];
            const { maxDD } = maxDrawdown(equity);
            // Peak was 108, trough was 95, DD = 13
            expect(maxDD).toBe(13);
        });
    });

    describe('Profit Factor', () => {
        it('returns Infinity for no losses', () => {
            expect(profitFactor([1, 2, 3])).toBe(Infinity);
        });

        it('returns 0 for no profits', () => {
            expect(profitFactor([-1, -2, -3])).toBe(0);
        });

        it('computes correctly', () => {
            expect(profitFactor([10, -5, 8, -3])).toBeCloseTo(18 / 8);
        });
    });
});

describe('Feature Engine', () => {
    const makeCandleSequence = (n: number, basePrice: number): Candle[] => {
        return Array.from({ length: n }, (_, i) => ({
            timestamp: 1700000000000 + i * 60000,
            open: basePrice + i * 10,
            high: basePrice + i * 10 + 20,
            low: basePrice + i * 10 - 10,
            close: basePrice + (i + 1) * 10,
            volume: 100 + Math.random() * 50,
            source: 'test',
        }));
    };

    it('computes features with valid output', () => {
        const engine = new FeatureEngine();
        const lookback = makeCandleSequence(15, 43000);
        const window = makeCandleSequence(5, 43200);

        const features = engine.compute(window, lookback);

        expect(features.windowStart).toBe(window[0]!.timestamp);
        expect(features.open).toBe(window[0]!.open);
        expect(features.close).toBe(window[window.length - 1]!.close);
        expect(features.rangeHL).toBeGreaterThan(0);
        expect(features.volume).toBeGreaterThan(0);
        expect(features.rsi14).toBeGreaterThan(0);
        expect(features.rsi14).toBeLessThanOrEqual(100);
    });

    it('toVector returns correct length', () => {
        const engine = new FeatureEngine();
        const lookback = makeCandleSequence(15, 43000);
        const window = makeCandleSequence(5, 43200);
        const features = engine.compute(window, lookback);

        const vector = FeatureEngine.toVector(features);
        expect(vector).toHaveLength(11);
        expect(FeatureEngine.featureNames()).toHaveLength(11);
    });

    it('batchCompute produces features for each window', () => {
        const candles = makeCandleSequence(20, 43000);
        const features = FeatureEngine.batchCompute(candles, 5);
        expect(features.length).toBe(20);
    });
});
