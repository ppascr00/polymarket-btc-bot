// ============================================
// Tests — Backtest Engine
// ============================================

import { describe, it, expect } from 'vitest';
import { BacktestEngine } from '../src/backtest/engine.js';
import { computeMetrics, formatMetrics } from '../src/backtest/metrics.js';
import { ProbabilisticStrategy } from '../src/strategy/probabilistic.js';
import { EmaCrossoverStrategy } from '../src/strategy/ema-crossover.js';
import type { Candle, TradeRecord, BacktestConfig } from '../src/types/index.js';

function makeCandles(count: number, basePrice: number = 43000): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;

    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.48) * 50; // slight upward bias
        price += change;
        candles.push({
            timestamp: 1700000000000 + i * 60000,
            open: price,
            high: price + Math.random() * 30,
            low: price - Math.random() * 30,
            close: price + change * 0.5,
            volume: 80 + Math.random() * 100,
            source: 'test',
        });
    }

    return candles;
}

const defaultConfig: BacktestConfig = {
    startDate: 1700000000000,
    endDate: 1700000000000 + 60 * 60000 * 24,
    initialBalance: 100,
    stakePerTrade: 2,
    strategy: 'probabilistic',
    impliedProbModel: 'sigmoid',
    commission: 0.02,
};

describe('Backtest Engine', () => {
    it('runs backtest with probabilistic strategy', () => {
        const strategy = new ProbabilisticStrategy(0.01);
        const candles = makeCandles(500);
        const config = {
            ...defaultConfig,
            endDate: candles[candles.length - 1]!.timestamp + 60000,
        };

        const engine = new BacktestEngine(strategy, config);
        const result = engine.run(candles);

        expect(result.trades.length).toBeGreaterThanOrEqual(0);
        expect(result.metrics.totalTrades).toBe(
            result.metrics.wins + result.metrics.losses
        );
        expect(result.metrics.hitRate).toBeGreaterThanOrEqual(0);
        expect(result.metrics.hitRate).toBeLessThanOrEqual(1);
    });

    it('runs backtest with EMA crossover strategy', () => {
        const strategy = new EmaCrossoverStrategy({ minEdge: 0.0 });
        const candles = makeCandles(500);
        const config = {
            ...defaultConfig,
            endDate: candles[candles.length - 1]!.timestamp + 60000,
            strategy: 'ema-crossover',
        };

        const engine = new BacktestEngine(strategy, config);
        const result = engine.run(candles);

        expect(result.metrics).toBeDefined();
        expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
    });
});

describe('Backtest Metrics', () => {
    it('computes metrics from empty trades', () => {
        const metrics = computeMetrics([]);
        expect(metrics.totalTrades).toBe(0);
        expect(metrics.hitRate).toBe(0);
        expect(metrics.totalPnL).toBe(0);
    });

    it('computes metrics from sample trades', () => {
        const trades: TradeRecord[] = [
            {
                timestamp: 1, windowStart: 0, mode: 'PAPER', strategy: 'test',
                direction: 'UP', confidence: 0.6, edge: 0.03, entryPrice: 0.5,
                marketYesPrice: 0.5, marketNoPrice: 0.5, stake: 5, pnl: 3,
                outcome: 'WIN', reasons: [],
            },
            {
                timestamp: 2, windowStart: 0, mode: 'PAPER', strategy: 'test',
                direction: 'DOWN', confidence: 0.5, edge: 0.02, entryPrice: 0.5,
                marketYesPrice: 0.5, marketNoPrice: 0.5, stake: 5, pnl: -5,
                outcome: 'LOSS', reasons: [],
            },
            {
                timestamp: 3, windowStart: 0, mode: 'PAPER', strategy: 'test',
                direction: 'UP', confidence: 0.7, edge: 0.04, entryPrice: 0.5,
                marketYesPrice: 0.5, marketNoPrice: 0.5, stake: 5, pnl: 4,
                outcome: 'WIN', reasons: [],
            },
        ];

        const metrics = computeMetrics(trades);
        expect(metrics.totalTrades).toBe(3);
        expect(metrics.wins).toBe(2);
        expect(metrics.losses).toBe(1);
        expect(metrics.hitRate).toBeCloseTo(2 / 3);
        expect(metrics.totalPnL).toBeCloseTo(2);
        expect(metrics.profitFactor).toBeCloseTo(7 / 5);
    });

    it('formats metrics without error', () => {
        const metrics = computeMetrics([]);
        const formatted = formatMetrics(metrics);
        expect(formatted).toContain('BACKTEST RESULTS');
        expect(formatted).toContain('Hit Rate');
        expect(formatted).toContain('Sharpe');
    });
});
