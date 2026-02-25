// ============================================
// Polymarket BTC Bot — Configuration Loader
// ============================================

import { config as dotenvConfig } from 'dotenv';
import type { BotConfig } from '../types/index.js';

dotenvConfig();

function env(key: string, defaultValue?: string): string {
    const value = process.env[key] ?? defaultValue;
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function envNum(key: string, defaultValue?: number): number {
    const raw = process.env[key];
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (isNaN(parsed)) throw new Error(`Invalid number for env var ${key}: ${raw}`);
        return parsed;
    }
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
}

function envBool(key: string, defaultValue?: boolean): boolean {
    const raw = process.env[key];
    if (raw !== undefined) return raw.toLowerCase() === 'true';
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
}

export function loadConfig(): BotConfig {
    const tradingMode = env('TRADING_MODE', 'PAPER') as 'PAPER' | 'LIVE';

    if (tradingMode !== 'PAPER' && tradingMode !== 'LIVE') {
        throw new Error(`Invalid TRADING_MODE: ${tradingMode}. Must be PAPER or LIVE.`);
    }

    // In LIVE mode, at minimum a private key is required.
    // API credentials can be derived automatically at runtime.
    if (tradingMode === 'LIVE') {
        if (!process.env.POLYMARKET_PRIVATE_KEY) {
            throw new Error(
                'LIVE mode requires POLYMARKET_PRIVATE_KEY to be set.'
            );
        }
    }

    return {
        tradingMode,
        strategy: env('STRATEGY', 'probabilistic'),

        binance: {
            wsUrl: env('BINANCE_WS_URL', 'wss://stream.binance.com:9443/ws'),
            restUrl: env('BINANCE_REST_URL', 'https://api.binance.com'),
            symbol: env('BINANCE_SYMBOL', 'BTCUSDT'),
        },

        polymarket: {
            apiUrl: env('POLYMARKET_API_URL', 'https://clob.polymarket.com'),
            privateKey: env('POLYMARKET_PRIVATE_KEY', ''),
            apiKey: env('POLYMARKET_API_KEY', ''),
            apiSecret: env('POLYMARKET_API_SECRET', ''),
            apiPassphrase: env('POLYMARKET_API_PASSPHRASE', ''),
            funderAddress: env('POLYMARKET_FUNDER_ADDRESS', ''),
            signatureType: envNum('POLYMARKET_SIGNATURE_TYPE', 0),
            chainId: envNum('POLYMARKET_CHAIN_ID', 137),
            marketSlug: env('POLYMARKET_MARKET_SLUG', 'bitcoin-5min-up-or-down'),
        },

        risk: {
            maxStakePerTrade: envNum('MAX_STAKE_PER_TRADE', 2),
            maxDailyLoss: envNum('MAX_DAILY_LOSS', 10),
            maxOpenPositions: envNum('MAX_OPEN_POSITIONS', 1),
            cooldownAfterLosses: envNum('COOLDOWN_AFTER_LOSSES', 3),
            slippageTolerance: envNum('SLIPPAGE_TOLERANCE', 0.03),
            minEdgeThreshold: envNum('MIN_EDGE_THRESHOLD', 0.02),
            spreadMaxTolerance: envNum('SPREAD_MAX_TOLERANCE', 0.10),
        },

        timing: {
            tradingCutoffSeconds: envNum('TRADING_CUTOFF_SECONDS', 15),
            dataStaleTresholdSeconds: envNum('DATA_STALE_THRESHOLD_SECONDS', 10),
            windowMinutes: envNum('WINDOW_MINUTES', 5),
        },

        db: {
            path: env('DB_PATH', './data/bot.db'),
        },

        dashboard: {
            port: envNum('DASHBOARD_PORT', 3000),
            password: env('DASHBOARD_PASSWORD', 'changeme'),
        },

        logging: {
            level: env('LOG_LEVEL', 'info'),
        },

        featureFlags: {
            autoPauseOnError: envBool('AUTO_PAUSE_ON_ERROR', true),
            autoPauseOnStaleData: envBool('AUTO_PAUSE_ON_STALE_DATA', true),
            maxConsecutiveErrors: envNum('MAX_CONSECUTIVE_ERRORS', 3),
        },
    };
}

// Singleton config instance
let _config: BotConfig | null = null;

export function getConfig(): BotConfig {
    if (!_config) {
        _config = loadConfig();
    }
    return _config;
}

export function resetConfig(): void {
    _config = null;
}
