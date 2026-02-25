// ============================================
// Polymarket BTC Bot — Backtest Runner Script
// ============================================
// Run with: npx tsx src/backtest/run.ts

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from '../utils/logger.js';
import { BinanceProvider } from '../data/exchange-provider.js';
import { BacktestEngine } from './engine.js';
import { runWalkForward } from './walk-forward.js';
import { formatMetrics } from './metrics.js';
import { createStrategy } from '../strategy/registry.js';
import { loadConfig } from '../config/index.js';
import fs from 'fs';
import path from 'path';

const logger = createLogger('info');

async function main() {
    const config = loadConfig();
    const strategyName = process.argv[2] || config.strategy;
    const daysBack = parseInt(process.argv[3] || '7', 10);

    logger.info(
        { strategy: strategyName, daysBack },
        '📊 Starting backtest'
    );

    // Fetch historical data from Binance
    const provider = new BinanceProvider(config);
    const end = Date.now();
    const start = end - daysBack * 24 * 60 * 60 * 1000;

    logger.info('Fetching historical candles from Binance...');

    const allCandles = [];
    let cursor = start;

    while (cursor < end) {
        const batchEnd = Math.min(cursor + 1000 * 60 * 1000, end);
        const candles = await provider.getHistoricalCandles(
            config.binance.symbol,
            '1m',
            cursor,
            batchEnd
        );
        allCandles.push(...candles);
        cursor = batchEnd;

        // Rate limit
        await new Promise((r) => setTimeout(r, 200));
    }

    logger.info({ totalCandles: allCandles.length }, 'Historical data fetched');

    if (allCandles.length === 0) {
        logger.error('No candles fetched. Check your date range and connection.');
        process.exit(1);
    }

    // --- Standard Backtest ---
    console.log('\n' + '='.repeat(50));
    console.log('  STANDARD BACKTEST');
    console.log('='.repeat(50) + '\n');

    const strategy = createStrategy(strategyName);
    const btEngine = new BacktestEngine(strategy, {
        startDate: start,
        endDate: end,
        initialBalance: 100,
        stakePerTrade: config.risk.maxStakePerTrade,
        strategy: strategyName,
        impliedProbModel: 'sigmoid',
        commission: 0.02,
    });

    const result = btEngine.run(allCandles);
    console.log(formatMetrics(result.metrics));

    // --- Walk-Forward Validation ---
    console.log('\n' + '='.repeat(50));
    console.log('  WALK-FORWARD VALIDATION');
    console.log('='.repeat(50) + '\n');

    const wfResult = runWalkForward({
        candles: allCandles,
        trainWindowMinutes: 24 * 60,   // 1 day training
        testWindowMinutes: 6 * 60,      // 6 hours testing
        stepMinutes: 6 * 60,            // 6 hour step
        strategyName,
        stakePerTrade: config.risk.maxStakePerTrade,
        commission: 0.02,
    });

    console.log('\nPer-fold results:');
    for (const fold of wfResult.folds) {
        console.log(
            `  Fold ${fold.foldIndex}: ` +
            `Hit=${(fold.metrics.hitRate * 100).toFixed(0)}% ` +
            `PnL=$${fold.metrics.totalPnL.toFixed(2)} ` +
            `Trades=${fold.metrics.totalTrades}`
        );
    }

    console.log('\nAggregate:');
    console.log(formatMetrics(wfResult.aggregateMetrics));

    // --- Export Results ---
    const outputDir = path.resolve('backtest-results');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // CSV export
    const csvHeader = 'timestamp,direction,confidence,edge,entryPrice,stake,pnl,outcome,strategy\n';
    const csvRows = result.trades.map(
        (t) =>
            `${new Date(t.timestamp).toISOString()},${t.direction},${t.confidence.toFixed(3)},${t.edge.toFixed(4)},${t.entryPrice.toFixed(4)},${t.stake.toFixed(2)},${t.pnl.toFixed(4)},${t.outcome},${t.strategy}`
    );
    const csvPath = path.join(outputDir, `backtest-${strategyName}-${timestamp}.csv`);
    fs.writeFileSync(csvPath, csvHeader + csvRows.join('\n'));

    // JSON export
    const jsonPath = path.join(outputDir, `backtest-${strategyName}-${timestamp}.json`);
    fs.writeFileSync(
        jsonPath,
        JSON.stringify(
            {
                config: { strategyName, daysBack, start, end },
                metrics: result.metrics,
                walkForward: {
                    folds: wfResult.folds.map((f) => ({
                        ...f,
                        trainStart: new Date(f.trainStart).toISOString(),
                        trainEnd: new Date(f.trainEnd).toISOString(),
                        testStart: new Date(f.testStart).toISOString(),
                        testEnd: new Date(f.testEnd).toISOString(),
                    })),
                    aggregateMetrics: wfResult.aggregateMetrics,
                },
                tradeCount: result.trades.length,
            },
            null,
            2
        )
    );

    console.log(`\n📁 Results exported to:`);
    console.log(`   CSV: ${csvPath}`);
    console.log(`   JSON: ${jsonPath}`);
}

main().catch((err) => {
    logger.error({ err }, 'Backtest failed');
    process.exit(1);
});
