// ============================================
// Polymarket BTC Bot — Main Entry Point
// ============================================
// Boots up all components and starts the trading loop.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createLogger } from './utils/logger.js';
import { loadConfig } from './config/index.js';
import { initializeDatabase } from './db/schema.js';
import { Repository } from './db/repository.js';
import { BinanceProvider } from './data/exchange-provider.js';
import { PolymarketCLOBClient } from './polymarket/client.js';
import { PolymarketMockClient } from './polymarket/client-mock.js';
import { createStrategy } from './strategy/registry.js';
import { DefaultRiskManager } from './risk/manager.js';
import { DefaultExecutionEngine } from './execution/engine.js';
import { Scheduler } from './execution/scheduler.js';
import type { PolymarketClient } from './types/index.js';

async function main() {
    // ─── Load Configuration ───────────────────────
    const config = loadConfig();
    const logger = createLogger(config.logging.level);

    logger.info('═══════════════════════════════════════════');
    logger.info('  Polymarket BTC 5m Up/Down Trading Bot');
    logger.info('═══════════════════════════════════════════');
    logger.info({ mode: config.tradingMode, strategy: config.strategy }, 'Configuration loaded');

    // ─── Disclaimer ───────────────────────────────
    logger.warn('⚠️  DISCLAIMER: This bot does NOT guarantee profits.');
    logger.warn('⚠️  Trading prediction markets carries risk of total loss.');
    logger.warn('⚠️  Use at your own risk. Default settings are conservative.');

    if (config.tradingMode === 'LIVE') {
        logger.warn('🔴 LIVE MODE ACTIVE — Real money at risk!');
        logger.info('Starting in 5 seconds... Press Ctrl+C to abort.');
        await new Promise((r) => setTimeout(r, 5000));
    }

    // ─── Initialize Database ──────────────────────
    const db = initializeDatabase(config.db.path);
    const repo = new Repository(db);
    logger.info('Database initialized');

    // ─── Initialize Exchange Provider ─────────────
    const exchange = new BinanceProvider(config);
    try {
        await exchange.connect();
        logger.info('✅ Binance WebSocket connected');
    } catch (err) {
        logger.error({ err }, 'Failed to connect to Binance WebSocket');
        logger.info('Will retry with REST fallback...');
    }

    // ─── Initialize Polymarket Client ─────────────
    let polymarket: PolymarketClient;

    if (config.tradingMode === 'LIVE') {
        polymarket = new PolymarketCLOBClient(config);
        logger.info('Using LIVE Polymarket CLOB client');
    } else {
        polymarket = new PolymarketMockClient(0.50);
        logger.info('Using MOCK Polymarket client (PAPER mode)');
    }

    // Verify market exists
    const market = await polymarket.findMarket(config.polymarket.marketSlug);
    if (market) {
        logger.info(
            {
                conditionId: market.conditionId,
                question: market.question,
                yesTokenId: market.yesTokenId.substring(0, 16) + '...',
                active: market.active,
            },
            '✅ Market found'
        );
    } else {
        logger.warn('Market not found. Will retry each cycle.');
    }

    // ─── Initialize Strategy ──────────────────────
    const strategyFromState = repo.getState('strategy_active');
    const selectedStrategyName = strategyFromState || config.strategy;
    const strategy = createStrategy(selectedStrategyName);
    repo.setState('strategy_active', strategy.name);
    logger.info({ strategy: strategy.name }, 'Strategy loaded');

    // Train on historical data if available
    const historicalFeatures = repo.getAllFeatures();
    if (historicalFeatures.length > 20 && strategy.train) {
        strategy.train(historicalFeatures);
        logger.info(
            { dataPoints: historicalFeatures.length },
            'Strategy trained on historical features'
        );
    }

    // ─── Initialize Risk Manager ──────────────────
    const riskManager = new DefaultRiskManager(config.risk);

    // Restore state from DB
    const dailyPnL = repo.getDailyPnL(
        new Date().setUTCHours(0, 0, 0, 0)
    );
    const consecutiveLosses = repo.getConsecutiveLosses();
    riskManager.restoreState(dailyPnL, consecutiveLosses);
    logger.info(
        { dailyPnL, consecutiveLosses },
        'Risk manager state restored'
    );

    // ─── Initialize Execution Engine ──────────────
    const executionEngine = new DefaultExecutionEngine(config, polymarket);

    // ─── Initialize Scheduler ─────────────────────
    const scheduler = new Scheduler(
        config,
        repo,
        exchange,
        polymarket,
        strategy,
        riskManager,
        executionEngine
    );

    // ─── Graceful Shutdown ────────────────────────
    const shutdown = async () => {
        logger.info('Shutting down...');
        scheduler.stop();
        await exchange.disconnect();
        db.close();
        logger.info('Goodbye! 👋');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // ─── Start ────────────────────────────────────
    logger.info('🚀 Starting scheduler...');
    await scheduler.start();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
