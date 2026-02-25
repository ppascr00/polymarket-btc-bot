import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const AVAILABLE_STRATEGIES = [
    'probabilistic',
    'ema-crossover',
    'rsi-reversion',
    'volatility-breakout',
];

interface RawRow {
    windowStart: number;
    timestamp: number;
    strategy: string;
    direction: string;
    confidence: number;
    edge: number;
    pUp: number;
    shouldTrade: number;
    decisionReason: string;
    tradeId: number | null;
    outcome: string | null;
    pnl: number | null;
    stake: number | null;
    btcPriceEntry: number | null;
    btcPriceClose: number | null;
}

function getDb() {
    try {
        return new Database(DB_PATH, { readonly: true });
    } catch {
        return null;
    }
}

function getActiveMode(db: Database.Database): 'PAPER' | 'LIVE' {
    const row = db
        .prepare('SELECT value FROM system_state WHERE key = ?')
        .get('trading_mode_active') as { value?: string } | undefined;
    const raw = (row?.value || process.env.TRADING_MODE || 'PAPER').toUpperCase();
    return raw === 'LIVE' ? 'LIVE' : 'PAPER';
}

export async function GET(request: Request) {
    const db = getDb();
    if (!db) {
        return NextResponse.json({
            mode: 'PAPER',
            strategies: AVAILABLE_STRATEGIES,
            rows: [],
            totalWindows: 0,
            limit: 0,
            offset: 0,
        });
    }

    try {
        const mode = getActiveMode(db);
        const url = new URL(request.url);
        const limitWindows = Math.min(
            500,
            Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24)
        );
        const offsetWindows = Math.max(
            0,
            parseInt(url.searchParams.get('offset') || '0', 10) || 0
        );

        if (mode !== 'PAPER') {
            db.close();
            return NextResponse.json({
                mode,
                strategies: AVAILABLE_STRATEGIES,
                rows: [],
                totalWindows: 0,
                limit: limitWindows,
                offset: offsetWindows,
            });
        }

        const totalWindowsRow = db.prepare(
            `
            SELECT COUNT(*) as cnt
            FROM (
                SELECT window_start
                FROM paper_strategy_signals
                WHERE mode = ?
                GROUP BY window_start
            )
            `
        ).get(mode) as { cnt: number };

        const rows = db.prepare(
            `
            WITH recent_windows AS (
                SELECT window_start
                FROM paper_strategy_signals
                WHERE mode = ?
                GROUP BY window_start
                ORDER BY window_start DESC
                LIMIT ?
                OFFSET ?
            )
            SELECT
                s.window_start as windowStart,
                s.timestamp as timestamp,
                s.strategy as strategy,
                s.direction as direction,
                s.confidence as confidence,
                s.edge as edge,
                s.p_up as pUp,
                s.should_trade as shouldTrade,
                s.decision_reason as decisionReason,
                s.trade_id as tradeId,
                t.outcome as outcome,
                t.pnl as pnl,
                t.stake as stake,
                t.btc_price_entry as btcPriceEntry,
                t.btc_price_close as btcPriceClose
            FROM paper_strategy_signals s
            LEFT JOIN trades t
                ON t.id = s.trade_id
            WHERE s.mode = ?
              AND s.window_start IN (SELECT window_start FROM recent_windows)
            ORDER BY s.window_start DESC, s.strategy ASC
            `
        ).all(mode, limitWindows, offsetWindows, mode) as RawRow[];

        const byWindow = new Map<
            number,
            {
                windowStart: number;
                timestamp: number;
                btcPriceEntry: number | null;
                btcPriceClose: number | null;
                totalStake: number;
                strategies: Record<string, {
                    direction: string;
                    confidence: number;
                    edge: number;
                    pUp: number;
                    shouldTrade: boolean;
                    decisionReason: string;
                    tradeId: number | null;
                    outcome: string | null;
                    pnl: number | null;
                    stake: number | null;
                }>;
            }
        >();

        for (const row of rows) {
            if (!byWindow.has(row.windowStart)) {
                byWindow.set(row.windowStart, {
                    windowStart: row.windowStart,
                    timestamp: row.timestamp,
                    btcPriceEntry: null,
                    btcPriceClose: null,
                    totalStake: 0,
                    strategies: {},
                });
            }
            const entry = byWindow.get(row.windowStart)!;
            if (row.btcPriceEntry !== null && row.btcPriceEntry !== undefined && entry.btcPriceEntry === null) {
                entry.btcPriceEntry = row.btcPriceEntry;
            }
            if (row.btcPriceClose !== null && row.btcPriceClose !== undefined && entry.btcPriceClose === null) {
                entry.btcPriceClose = row.btcPriceClose;
            }
            if (row.stake !== null && row.stake !== undefined) {
                entry.totalStake += row.stake;
            }
            entry.strategies[row.strategy] = {
                direction: row.direction,
                confidence: row.confidence,
                edge: row.edge,
                pUp: row.pUp,
                shouldTrade: row.shouldTrade === 1,
                decisionReason: row.decisionReason,
                tradeId: row.tradeId,
                outcome: row.outcome,
                pnl: row.pnl,
                stake: row.stake,
            };
        }

        const normalizedRows = Array.from(byWindow.values()).map((row) => {
            const strategies: Record<string, unknown> = {};
            for (const strategy of AVAILABLE_STRATEGIES) {
                strategies[strategy] = row.strategies[strategy] ?? null;
            }
            return {
                windowStart: row.windowStart,
                timestamp: row.timestamp,
                btcPriceEntry: row.btcPriceEntry,
                btcPriceClose: row.btcPriceClose,
                totalStake: row.totalStake,
                strategies,
            };
        });

        db.close();
        return NextResponse.json({
            mode,
            strategies: AVAILABLE_STRATEGIES,
            rows: normalizedRows,
            totalWindows: totalWindowsRow.cnt,
            limit: limitWindows,
            offset: offsetWindows,
        });
    } catch (err) {
        const msg = String(err);
        if (msg.includes('no such table')) {
            try { db.close(); } catch { }
            return NextResponse.json({
                mode: 'PAPER',
                strategies: AVAILABLE_STRATEGIES,
                rows: [],
                totalWindows: 0,
                limit: 0,
                offset: 0,
            });
        }
        try { db.close(); } catch { }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
