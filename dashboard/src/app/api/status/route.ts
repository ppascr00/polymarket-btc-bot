export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { getBotProcessStatus } from '@/lib/bot-process';
import { getPolymarketLiveBalance } from '@/lib/polymarket-balance';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const AVAILABLE_STRATEGIES = [
    'probabilistic',
    'ema-crossover',
    'rsi-reversion',
    'volatility-breakout',
    'ai-adaptive',
];
const AVAILABLE_MODES = ['PAPER', 'LIVE'];

function getDb() {
    try {
        return new Database(DB_PATH, { readonly: true });
    } catch (e) {
        console.error("Dashboard Status DB Connect Error:", e);
        return null;
    }
}

function getActiveMode(db: Database.Database): 'PAPER' | 'LIVE' {
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get('trading_mode_active') as { value?: string } | undefined;
    const raw = (row?.value || process.env.TRADING_MODE || 'PAPER').toUpperCase();
    return raw === 'LIVE' ? 'LIVE' : 'PAPER';
}

function getPaperMultiEnabled(db: Database.Database, activeMode: 'PAPER' | 'LIVE'): boolean {
    if (activeMode !== 'PAPER') return false;
    const row = db
        .prepare('SELECT value FROM system_state WHERE key = ?')
        .get('paper_multi_enabled') as { value?: string } | undefined;
    if (!row?.value) return false;
    return row.value === 'true';
}

export async function GET() {
    const processStatus = getBotProcessStatus();
    const db = getDb();

    if (!db) {
        return NextResponse.json({
            status: {
                mode: (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER',
                availableModes: AVAILABLE_MODES,
                accountBalance: null,
                accountBalanceSource: 'live-unavailable',
                accountBalanceError: 'DB unavailable',
                running: false,
                processRunning: processStatus.running,
                paused: false,
                paperMultiEnabled: false,
                strategy: process.env.STRATEGY || 'probabilistic',
                availableStrategies: AVAILABLE_STRATEGIES,
                consecutiveErrors: 0,
                lastSignal: null,
                health: {
                    exchangeConnected: false,
                    exchangeLatencyMs: Infinity,
                    dbOk: false,
                    uptimeSeconds: 0,
                },
            },
            stats: {
                totalTrades: 0,
                todayTrades: 0,
                todayPnL: 0,
                totalPnL: 0,
                winRate: 0,
                consecutiveLosses: 0,
                recentPnLs: [],
            },
        });
    }

    try {
        const activeMode = getActiveMode(db);
        const paperMultiEnabled = getPaperMultiEnabled(db, activeMode);
        // Get today's stats
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        const todayStats = db.prepare(`
      SELECT
        COUNT(*) as trades,
        COALESCE(SUM(pnl), 0) as pnl,
        COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) as wins
      FROM trades
      WHERE timestamp >= ? AND mode = ?
    `).get(todayMs, activeMode) as { trades: number; pnl: number; wins: number };

        const totalStats = db.prepare(`
      SELECT
        COUNT(*) as trades,
        COALESCE(SUM(pnl), 0) as pnl,
        COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) as wins
      FROM trades
      WHERE outcome != 'PENDING' AND mode = ?
    `).get(activeMode) as { trades: number; pnl: number; wins: number };

        // Recent P&Ls for chart
        const recentTrades = db.prepare(`
      SELECT pnl FROM trades
      WHERE outcome != 'PENDING' AND mode = ?
      ORDER BY timestamp DESC
      LIMIT 30
    `).all(activeMode) as Array<{ pnl: number }>;

        // Consecutive losses
        const recentOutcomes = db.prepare(`
      SELECT outcome FROM trades
      WHERE outcome != 'PENDING' AND mode = ?
      ORDER BY timestamp DESC
      LIMIT 20
    `).all(activeMode) as Array<{ outcome: string }>;

        let consecutiveLosses = 0;
        for (const r of recentOutcomes) {
            if (r.outcome === 'LOSS') consecutiveLosses++;
            else break;
        }

        // System state
        const getState = (key: string) => {
            const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(key) as { value: string } | undefined;
            return row?.value;
        };

        const pausedState = getState('paused') === 'true';
        const consecutiveErrorsState = parseInt(getState('consecutive_errors') || '0');
        const strategyState = getState('strategy_active') || process.env.STRATEGY || 'probabilistic';
        const lastHeartbeat = parseInt(getState('last_heartbeat') || '0');
        const lastSignalRaw = getState('last_signal');
        const lastSignal = (() => {
            if (!lastSignalRaw) return null;
            try {
                return JSON.parse(lastSignalRaw);
            } catch {
                return null;
            }
        })();
        const isRunning = Number.isFinite(lastHeartbeat) && lastHeartbeat > 0
            ? (Date.now() - lastHeartbeat) < 90_000
            : false;
        const paperInitialCapital = paperMultiEnabled
            ? 100 * AVAILABLE_STRATEGIES.length
            : 100;
        const paperBalance = paperInitialCapital + totalStats.pnl;
        const liveBalance = activeMode === 'LIVE'
            ? await getPolymarketLiveBalance()
            : { balance: null, source: 'paper-simulated' as const };

        db.close();

        return NextResponse.json({
            status: {
                mode: activeMode,
                availableModes: AVAILABLE_MODES,
                accountBalance: activeMode === 'PAPER' ? paperBalance : liveBalance.balance,
                accountBalanceSource: activeMode === 'PAPER'
                    ? (paperMultiEnabled ? 'paper-simulated-multi' : 'paper-simulated')
                    : liveBalance.source,
                accountBalanceError: activeMode === 'LIVE' ? (liveBalance.error || null) : null,
                running: isRunning,
                processRunning: processStatus.running,
                paused: pausedState,
                paperMultiEnabled,
                strategy: strategyState,
                availableStrategies: AVAILABLE_STRATEGIES,
                consecutiveErrors: consecutiveErrorsState,
                lastSignal,
                health: {
                    exchangeConnected: true,
                    exchangeLatencyMs: 0,
                    dbOk: true,
                    uptimeSeconds: Math.floor(process.uptime()),
                },
            },
            stats: {
                totalTrades: totalStats.trades,
                todayTrades: todayStats.trades,
                todayPnL: todayStats.pnl,
                totalPnL: totalStats.pnl,
                winRate: totalStats.trades > 0 ? totalStats.wins / totalStats.trades : 0,
                consecutiveLosses,
                recentPnLs: recentTrades.map((t) => t.pnl).reverse(),
            },
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
