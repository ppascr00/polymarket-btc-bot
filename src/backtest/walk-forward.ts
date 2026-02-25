// ============================================
// Polymarket BTC Bot — Walk-Forward Validation
// ============================================
// Rolling train/test windows for out-of-sample testing.

import { getLogger } from '../utils/logger.js';
import { OHLCVAggregator } from '../data/ohlcv-aggregator.js';
import { FeatureEngine } from '../data/feature-engine.js';
import { BacktestEngine } from './engine.js';
import { computeMetrics, formatMetrics } from './metrics.js';
import { createStrategy } from '../strategy/registry.js';
import type {
    Candle,
    BacktestConfig,
    BacktestResult,
    BacktestMetrics,
} from '../types/index.js';

const logger = getLogger();

export interface WalkForwardConfig {
    /** Total candles (1m) */
    candles: Candle[];
    /** Training window size in minutes */
    trainWindowMinutes: number;
    /** Test window size in minutes */
    testWindowMinutes: number;
    /** Step size in minutes (how much to advance each fold) */
    stepMinutes: number;
    /** Strategy name */
    strategyName: string;
    /** Stake per trade */
    stakePerTrade: number;
    /** Commission rate */
    commission: number;
}

export interface WalkForwardResult {
    folds: Array<{
        foldIndex: number;
        trainStart: number;
        trainEnd: number;
        testStart: number;
        testEnd: number;
        metrics: BacktestMetrics;
    }>;
    aggregateMetrics: BacktestMetrics;
}

/**
 * Run walk-forward validation.
 * Slides a train/test window through the data.
 */
export function runWalkForward(config: WalkForwardConfig): WalkForwardResult {
    const {
        candles,
        trainWindowMinutes,
        testWindowMinutes,
        stepMinutes,
        strategyName,
        stakePerTrade,
        commission,
    } = config;

    if (candles.length === 0) {
        throw new Error('No candles provided for walk-forward');
    }

    const trainMs = trainWindowMinutes * 60 * 1000;
    const testMs = testWindowMinutes * 60 * 1000;
    const stepMs = stepMinutes * 60 * 1000;

    const dataStart = candles[0]!.timestamp;
    const dataEnd = candles[candles.length - 1]!.timestamp;
    const totalMs = dataEnd - dataStart;

    if (totalMs < trainMs + testMs) {
        throw new Error(
            `Not enough data. Need ${trainWindowMinutes + testWindowMinutes}min, have ${(totalMs / 60000).toFixed(0)}min`
        );
    }

    const folds: WalkForwardResult['folds'] = [];
    let allTrades: BacktestResult['trades'] = [];
    let foldIndex = 0;

    for (
        let offset = 0;
        offset + trainMs + testMs <= totalMs;
        offset += stepMs
    ) {
        const trainStart = dataStart + offset;
        const trainEnd = trainStart + trainMs;
        const testStart = trainEnd;
        const testEnd = testStart + testMs;

        // Create fresh strategy for each fold
        const strategy = createStrategy(strategyName);

        const btConfig: BacktestConfig = {
            startDate: trainStart,
            endDate: testEnd,
            initialBalance: 100,
            stakePerTrade,
            strategy: strategyName,
            impliedProbModel: 'sigmoid',
            commission,
        };

        const engine = new BacktestEngine(strategy, btConfig);
        const result = engine.run(candles);

        folds.push({
            foldIndex,
            trainStart,
            trainEnd,
            testStart,
            testEnd,
            metrics: result.metrics,
        });

        allTrades = allTrades.concat(result.trades);
        foldIndex++;

        logger.info(
            {
                fold: foldIndex,
                hitRate: (result.metrics.hitRate * 100).toFixed(1) + '%',
                pnl: result.metrics.totalPnL.toFixed(2),
            },
            'Walk-forward fold complete'
        );
    }

    const aggregateMetrics = computeMetrics(allTrades);

    logger.info(
        {
            totalFolds: folds.length,
            aggregateHitRate: (aggregateMetrics.hitRate * 100).toFixed(1) + '%',
            aggregatePnL: aggregateMetrics.totalPnL.toFixed(2),
            aggregateSharpe: aggregateMetrics.sharpeRatio.toFixed(3),
        },
        'Walk-forward validation complete'
    );

    return { folds, aggregateMetrics };
}
