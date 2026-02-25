import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const AVAILABLE_STRATEGIES = [
    'probabilistic',
    'ema-crossover',
    'rsi-reversion',
    'volatility-breakout',
];

type WindowKey = 'today' | '24h' | '7d' | '30d' | 'all';

interface RawStrategyRow {
    strategy: string;
    totalTrades: number;
    pendingTrades: number;
    wins: number;
    losses: number;
    pnl: number;
    avgEdge: number;
    avgConfidence: number;
    avgStake: number;
}

interface StrategyStatsViewRow {
    strategy: string;
    totalTrades: number;
    closedTrades: number;
    pendingTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    pnl: number;
    avgEdge: number;
    avgConfidence: number;
    avgStake: number;
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

function parseWindow(raw: string | null): WindowKey {
    switch ((raw || '').toLowerCase()) {
        case 'today':
            return 'today';
        case '24h':
            return '24h';
        case '7d':
            return '7d';
        case '30d':
            return '30d';
        default:
            return 'all';
    }
}

function resolveSinceMs(windowKey: WindowKey): number | null {
    if (windowKey === 'all') return null;
    if (windowKey === 'today') {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
    }

    const now = Date.now();
    const map: Record<'24h' | '7d' | '30d', number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
    };
    return now - map[windowKey];
}

function toViewRow(row: RawStrategyRow): StrategyStatsViewRow {
    const closedTrades = row.wins + row.losses;
    return {
        strategy: row.strategy,
        totalTrades: row.totalTrades,
        closedTrades,
        pendingTrades: row.pendingTrades,
        wins: row.wins,
        losses: row.losses,
        winRate: closedTrades > 0 ? row.wins / closedTrades : 0,
        pnl: row.pnl,
        avgEdge: row.avgEdge,
        avgConfidence: row.avgConfidence,
        avgStake: row.avgStake,
    };
}

function recommendationConfidence(closedTrades: number): 'low' | 'medium' | 'high' {
    if (closedTrades >= 80) return 'high';
    if (closedTrades >= 30) return 'medium';
    return 'low';
}

function buildRecommendation(
    rows: StrategyStatsViewRow[],
    windowKey: WindowKey,
    minClosedTrades: number
) {
    let candidates = rows.filter((r) => r.closedTrades >= minClosedTrades);
    let fallbackUsed = false;

    if (candidates.length === 0) {
        candidates = rows.filter((r) => r.closedTrades > 0);
        fallbackUsed = true;
    }

    if (candidates.length === 0) {
        return {
            strategy: null,
            confidence: 'low' as const,
            reason: 'No closed trades yet in this window.',
            minClosedTrades,
            basedOnWindow: windowKey,
            sampleClosedTrades: 0,
            metrics: null,
        };
    }

    const ranked = [...candidates].sort((a, b) => {
        const aPnlPerTrade = a.closedTrades > 0 ? a.pnl / a.closedTrades : -Infinity;
        const bPnlPerTrade = b.closedTrades > 0 ? b.pnl / b.closedTrades : -Infinity;

        if (bPnlPerTrade !== aPnlPerTrade) return bPnlPerTrade - aPnlPerTrade;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (b.closedTrades !== a.closedTrades) return b.closedTrades - a.closedTrades;
        if (b.avgEdge !== a.avgEdge) return b.avgEdge - a.avgEdge;
        return a.strategy.localeCompare(b.strategy);
    });

    const best = ranked[0]!;
    const pnlPerTrade = best.closedTrades > 0 ? best.pnl / best.closedTrades : 0;
    const confidence = recommendationConfidence(best.closedTrades);

    if (pnlPerTrade <= 0) {
        return {
            strategy: null,
            confidence: 'low' as const,
            reason: `No strategy is profitable in ${windowKey}. Best damage control so far: ${best.strategy}.`,
            minClosedTrades,
            basedOnWindow: windowKey,
            sampleClosedTrades: best.closedTrades,
            metrics: {
                pnl: best.pnl,
                winRate: best.winRate,
                pnlPerTrade,
                avgEdge: best.avgEdge,
                avgConfidence: best.avgConfidence,
            },
        };
    }

    const reason = fallbackUsed
        ? `No strategy reached ${minClosedTrades} closed trades. Best observed so far: ${best.strategy} (${best.closedTrades} closed trades).`
        : `Best P&L per closed trade in ${windowKey}: ${best.strategy}.`;

    return {
        strategy: best.strategy,
        confidence,
        reason,
        minClosedTrades,
        basedOnWindow: windowKey,
        sampleClosedTrades: best.closedTrades,
        metrics: {
            pnl: best.pnl,
            winRate: best.winRate,
            pnlPerTrade,
            avgEdge: best.avgEdge,
            avgConfidence: best.avgConfidence,
        },
    };
}

export async function GET(request: Request) {
    const db = getDb();
    if (!db) {
        return NextResponse.json({
            mode: 'PAPER',
            window: 'all',
            since: null,
            rows: [],
        });
    }

    try {
        const url = new URL(request.url);
        const windowKey = parseWindow(url.searchParams.get('window'));
        const sinceMs = resolveSinceMs(windowKey);
        const minClosedTrades = Math.min(
            200,
            Math.max(1, parseInt(url.searchParams.get('minClosed') || '20'))
        );
        const activeMode = getActiveMode(db);

        const whereClause = sinceMs === null ? 'mode = ?' : 'mode = ? AND timestamp >= ?';
        const params = sinceMs === null ? [activeMode] : [activeMode, sinceMs];

        const rows = db
            .prepare(`
        SELECT
          strategy,
          COUNT(*) as totalTrades,
          COALESCE(SUM(CASE WHEN outcome = 'PENDING' THEN 1 ELSE 0 END), 0) as pendingTrades,
          COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END), 0) as losses,
          COALESCE(SUM(CASE WHEN outcome != 'PENDING' THEN pnl ELSE 0 END), 0) as pnl,
          COALESCE(AVG(CASE WHEN outcome != 'PENDING' THEN edge END), 0) as avgEdge,
          COALESCE(AVG(CASE WHEN outcome != 'PENDING' THEN confidence END), 0) as avgConfidence,
          COALESCE(AVG(CASE WHEN outcome != 'PENDING' THEN stake END), 0) as avgStake
        FROM trades
        WHERE ${whereClause}
        GROUP BY strategy
      `)
            .all(...params) as RawStrategyRow[];

        const map = new Map(rows.map((r) => [r.strategy, r]));
        const known = AVAILABLE_STRATEGIES.map((name) => toViewRow(map.get(name) ?? {
            strategy: name,
            totalTrades: 0,
            pendingTrades: 0,
            wins: 0,
            losses: 0,
            pnl: 0,
            avgEdge: 0,
            avgConfidence: 0,
            avgStake: 0,
        }));

        const extra = rows
            .filter((r) => !AVAILABLE_STRATEGIES.includes(r.strategy))
            .map(toViewRow);

        const sorted = [...known, ...extra].sort((a, b) => {
            if (b.closedTrades !== a.closedTrades) return b.closedTrades - a.closedTrades;
            if (b.pnl !== a.pnl) return b.pnl - a.pnl;
            return a.strategy.localeCompare(b.strategy);
        });
        const recommendation = buildRecommendation(sorted, windowKey, minClosedTrades);

        db.close();

        return NextResponse.json({
            mode: activeMode,
            window: windowKey,
            since: sinceMs,
            minClosedTrades,
            rows: sorted,
            recommendation,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
