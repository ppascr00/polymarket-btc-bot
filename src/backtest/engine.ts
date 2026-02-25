// ============================================
// Polymarket BTC Bot — Backtest Engine
// ============================================
// Offline simulation using historical OHLCV data.

import { getLogger } from '../utils/logger.js';
import { OHLCVAggregator } from '../data/ohlcv-aggregator.js';
import { FeatureEngine } from '../data/feature-engine.js';
import { sigmoid } from '../utils/math.js';
import { computeMetrics } from './metrics.js';
import type {
    Candle,
    FeatureSet,
    Signal,
    TradeRecord,
    MarketState,
    BacktestConfig,
    BacktestResult,
    BacktestMetrics,
    Strategy,
    PolymarketMarket,
    Orderbook,
} from '../types/index.js';

const logger = getLogger();

export class BacktestEngine {
    private strategy: Strategy;
    private config: BacktestConfig;

    constructor(strategy: Strategy, config: BacktestConfig) {
        this.strategy = strategy;
        this.config = config;
    }

    /**
     * Run backtest on historical 1m candles.
     */
    run(candles1m: Candle[]): BacktestResult {
        logger.info(
            {
                candles: candles1m.length,
                strategy: this.strategy.name,
                start: new Date(this.config.startDate).toISOString(),
                end: new Date(this.config.endDate).toISOString(),
            },
            'Starting backtest'
        );

        // Filter candles to date range
        const filtered = candles1m.filter(
            (c) => c.timestamp >= this.config.startDate && c.timestamp <= this.config.endDate
        );

        if (filtered.length === 0) {
            logger.warn('No candles in date range');
            return { trades: [], metrics: computeMetrics([]) };
        }

        // Aggregate to 5m
        const candles5m = OHLCVAggregator.batchAggregate(filtered, 5);
        logger.info({ windows: candles5m.length }, '5m candles aggregated');

        // Compute features
        const featureSets = FeatureEngine.batchCompute(candles5m, 20);

        // Train strategy if trainable (use first 60% for training)
        const trainSplit = Math.floor(featureSets.length * 0.6);
        if (this.strategy.train && trainSplit > 20) {
            const trainingData = featureSets.slice(0, trainSplit);
            this.strategy.train(trainingData);
            logger.info(
                { trainingWindows: trainingData.length },
                'Strategy trained on historical data'
            );
        }

        // Simulate trading on remaining windows
        const testData = this.strategy.train
            ? featureSets.slice(trainSplit)
            : featureSets;

        const trades: TradeRecord[] = [];
        let balance = this.config.initialBalance;
        let consecutiveLosses = 0;

        for (let i = 1; i < testData.length; i++) {
            const features = testData[i]!;
            const prevFeatures = testData[i - 1]!;

            // Simulate market state
            const marketState = this.simulateMarketState(features);

            // Get signal
            const signal = this.strategy.compute(features, marketState);

            if (signal.direction === 'NO_TRADE') continue;
            if (signal.edge < 0.02) continue; // min edge for backtest

            // Check consecutive losses cooldown
            if (consecutiveLosses >= 3) {
                consecutiveLosses = 0;
                continue; // skip this window as cooldown
            }

            // Determine actual outcome
            const actualUp = features.close > features.open;
            const isCorrect =
                (signal.direction === 'UP' && actualUp) ||
                (signal.direction === 'DOWN' && !actualUp);

            const stake = Math.min(this.config.stakePerTrade, balance * 0.1);
            if (stake <= 0) break; // ran out of money

            // Simplified P&L model
            const entryPrice = signal.direction === 'UP'
                ? marketState.yesPrice
                : marketState.noPrice;

            const pnl = isCorrect
                ? stake * (1 / entryPrice - 1) - this.config.commission * stake
                : -(stake + this.config.commission * stake);

            balance += pnl;

            const trade: TradeRecord = {
                timestamp: features.windowStart,
                windowStart: features.windowStart,
                mode: 'PAPER',
                strategy: this.strategy.name,
                direction: signal.direction,
                confidence: signal.confidence,
                edge: signal.edge,
                entryPrice,
                marketYesPrice: marketState.yesPrice,
                marketNoPrice: marketState.noPrice,
                stake,
                pnl,
                outcome: isCorrect ? 'WIN' : 'LOSS',
                reasons: signal.reasons,
            };

            trades.push(trade);

            if (isCorrect) {
                consecutiveLosses = 0;
            } else {
                consecutiveLosses++;
            }
        }

        const metrics = computeMetrics(trades);

        logger.info(
            {
                totalTrades: metrics.totalTrades,
                hitRate: (metrics.hitRate * 100).toFixed(1) + '%',
                totalPnL: metrics.totalPnL.toFixed(2),
                sharpe: metrics.sharpeRatio.toFixed(3),
            },
            'Backtest complete'
        );

        return { trades, metrics };
    }

    /**
     * Simulate Polymarket market state from features.
     * Uses sigmoid of recent returns as implied probability.
     */
    private simulateMarketState(features: FeatureSet): MarketState {
        let impliedProbUp: number;

        switch (this.config.impliedProbModel) {
            case 'sigmoid':
                // Map 5m return to probability via sigmoid
                impliedProbUp = sigmoid(features.ret5m * 100);
                break;
            case 'fixed':
                impliedProbUp = 0.50;
                break;
            case 'historical':
                // TODO: use historical Polymarket prices if available
                impliedProbUp = 0.50;
                break;
            default:
                impliedProbUp = 0.50;
        }

        // Add some noise for realism
        impliedProbUp = Math.max(0.05, Math.min(0.95, impliedProbUp + (Math.random() - 0.5) * 0.05));

        const yesPrice = impliedProbUp;
        const noPrice = 1 - impliedProbUp;

        const mockMarket: PolymarketMarket = {
            conditionId: 'backtest-mock',
            slug: 'backtest-btc-5m',
            question: 'Backtest: Will BTC go up?',
            yesTokenId: 'backtest-yes',
            noTokenId: 'backtest-no',
            active: true,
            endDate: '',
        };

        const mockOrderbook = (price: number): Orderbook => ({
            bids: [{ price: price - 0.01, size: 100 }],
            asks: [{ price: price + 0.01, size: 100 }],
            midPrice: price,
            spread: 0.02,
            timestamp: features.windowStart,
        });

        return {
            market: mockMarket,
            yesOrderbook: mockOrderbook(yesPrice),
            noOrderbook: mockOrderbook(noPrice),
            yesPrice,
            noPrice,
            impliedProbUp,
        };
    }
}
