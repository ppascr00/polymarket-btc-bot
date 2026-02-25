// ============================================
// Polymarket BTC Bot — OHLCV Aggregator
// ============================================
// Aggregates 1m candles into 5m windows aligned to UTC.

import { getLogger } from '../utils/logger.js';
import { alignToWindow } from '../utils/time.js';
import type { Candle } from '../types/index.js';

const logger = getLogger();

export class OHLCVAggregator {
    private windowMinutes: number;
    private currentWindowCandles: Candle[] = [];
    private currentWindowStart: number = 0;

    constructor(windowMinutes: number = 5) {
        this.windowMinutes = windowMinutes;
    }

    /**
     * Process a new 1m candle and return a completed 5m aggregation if the window is full.
     */
    addCandle(candle: Candle): Candle | null {
        const windowStart = alignToWindow(candle.timestamp, this.windowMinutes);

        // If we've moved to a new window, finalize the previous one
        if (windowStart !== this.currentWindowStart && this.currentWindowCandles.length > 0) {
            const aggregated = this.aggregate(this.currentWindowCandles, this.currentWindowStart);
            this.currentWindowCandles = [candle];
            this.currentWindowStart = windowStart;
            return aggregated;
        }

        // Same window — accumulate
        if (this.currentWindowStart === 0) {
            this.currentWindowStart = windowStart;
        }
        this.currentWindowCandles.push(candle);
        return null;
    }

    /**
     * Force aggregate whatever we have in the current window (for end-of-window signals).
     */
    getCurrentAggregate(): Candle | null {
        if (this.currentWindowCandles.length === 0) return null;
        return this.aggregate(this.currentWindowCandles, this.currentWindowStart);
    }

    /**
     * Get the candles in the current accumulation window.
     */
    getCurrentCandles(): Candle[] {
        return [...this.currentWindowCandles];
    }

    /**
     * Aggregate an array of 1m candles into one 5m candle.
     */
    private aggregate(candles: Candle[], windowStart: number): Candle {
        const first = candles[0]!;
        const last = candles[candles.length - 1]!;

        const aggregated: Candle = {
            timestamp: windowStart,
            open: first.open,
            high: Math.max(...candles.map((c) => c.high)),
            low: Math.min(...candles.map((c) => c.low)),
            close: last.close,
            volume: candles.reduce((sum, c) => sum + c.volume, 0),
            source: first.source,
        };

        logger.debug(
            {
                windowStart,
                candleCount: candles.length,
                open: aggregated.open,
                close: aggregated.close,
            },
            '5m candle aggregated'
        );

        return aggregated;
    }

    /**
     * Batch aggregate: given a sorted array of 1m candles, produce 5m candles.
     * Used for backtesting with historical data.
     */
    static batchAggregate(candles: Candle[], windowMinutes: number = 5): Candle[] {
        const aggregator = new OHLCVAggregator(windowMinutes);
        const results: Candle[] = [];

        for (const candle of candles) {
            const result = aggregator.addCandle(candle);
            if (result) {
                results.push(result);
            }
        }

        // Don't forget any remaining partial window
        const last = aggregator.getCurrentAggregate();
        if (last) {
            results.push(last);
        }

        return results;
    }

    reset(): void {
        this.currentWindowCandles = [];
        this.currentWindowStart = 0;
    }
}
