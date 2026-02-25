// ============================================
// Polymarket BTC Bot — Feature Engine
// ============================================
// Computes all technical features from raw candle data.

import {
    ema,
    emaSeries,
    rsi,
    realizedVolatility,
    simpleReturn,
} from '../utils/math.js';
import type { Candle, FeatureSet } from '../types/index.js';

export class FeatureEngine {
    /**
     * Compute features for a 5-minute window given the 1m candles
     * within and slightly before (for lookback) the window.
     *
     * @param windowCandles  - The 1m candles in the current 5m window (1-5 candles)
     * @param lookbackCandles - Recent 1m candles before the window (for EMA/RSI lookback)
     * @param obImbalance    - Orderbook imbalance from exchange (-1 to 1), optional
     * @param spread         - Bid-ask spread from exchange, optional
     * @param midChange      - Change in mid price since last check, optional
     */
    compute(
        windowCandles: Candle[],
        lookbackCandles: Candle[],
        obImbalance: number = 0,
        spread: number = 0,
        midChange: number = 0
    ): FeatureSet {
        // Combine lookback + window for indicator calculation
        const allCandles = [...lookbackCandles, ...windowCandles];
        const closes = allCandles.map((c) => c.close);

        // Window boundaries
        const firstInWindow = windowCandles[0]!;
        const lastInWindow = windowCandles[windowCandles.length - 1]!;

        const windowStart = firstInWindow.timestamp;
        const windowEnd = lastInWindow.timestamp + 60_000; // end of last 1m candle
        const windowOpen = firstInWindow.open;
        const windowClose = lastInWindow.close;

        // Returns
        const ret5m = simpleReturn(windowOpen, windowClose);
        const ret1m =
            windowCandles.length >= 2
                ? simpleReturn(
                    windowCandles[windowCandles.length - 2]!.close,
                    windowClose
                )
                : 0;

        // EMAs (computed on all available closes for smoothness)
        const ema3 = ema(closes, 3);
        const ema8 = ema(closes, 8);

        // RSI
        const rsi14 = rsi(closes, 14);

        // Realized volatility
        const vol = realizedVolatility(closes);

        // Range (high-low) relative to open
        const allInWindow = windowCandles;
        const highOfWindow = Math.max(...allInWindow.map((c) => c.high));
        const lowOfWindow = Math.min(...allInWindow.map((c) => c.low));
        const rangeHL = windowOpen > 0 ? (highOfWindow - lowOfWindow) / windowOpen : 0;

        // Volume
        const volume = allInWindow.reduce((sum, c) => sum + c.volume, 0);

        return {
            windowStart,
            windowEnd,
            open: windowOpen,
            close: windowClose,
            ret1m,
            ret5m,
            ema3,
            ema8,
            rsi14,
            volatility: vol,
            rangeHL,
            volume,
            obImbalance,
            spread,
            midChange,
        };
    }

    /**
     * Extract the feature vector as a number array for model input.
     * Order must match training feature order.
     */
    static toVector(features: FeatureSet): number[] {
        return [
            features.ret1m,
            features.ret5m,
            features.ema3,
            features.ema8,
            features.rsi14,
            features.volatility,
            features.rangeHL,
            features.volume,
            features.obImbalance,
            features.spread,
            features.midChange,
        ];
    }

    /**
     * Feature names in the same order as toVector.
     */
    static featureNames(): string[] {
        return [
            'ret1m',
            'ret5m',
            'ema3',
            'ema8',
            'rsi14',
            'volatility',
            'rangeHL',
            'volume',
            'obImbalance',
            'spread',
            'midChange',
        ];
    }

    /**
     * Batch compute features from a sequence of 5m candles (for backtesting).
     * Each 5m candle is treated as a single-candle "window",
     * with previous candles as lookback.
     */
    static batchCompute(
        candles5m: Candle[],
        lookbackSize: number = 20
    ): FeatureSet[] {
        const engine = new FeatureEngine();
        const results: FeatureSet[] = [];

        for (let i = 0; i < candles5m.length; i++) {
            const lookbackStart = Math.max(0, i - lookbackSize);
            const lookback = candles5m.slice(lookbackStart, i);
            const current = [candles5m[i]!];
            results.push(engine.compute(current, lookback));
        }

        return results;
    }
}
