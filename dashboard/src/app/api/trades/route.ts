import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');

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
        return NextResponse.json({ trades: [], total: 0, limit: 0, offset: 0, mode: 'PAPER', hasMore: false });
    }

    try {
        const url = new URL(request.url);
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
        const activeMode = getActiveMode(db);

        const totalRow = db
            .prepare('SELECT COUNT(*) as total FROM trades WHERE mode = ?')
            .get(activeMode) as { total: number };
        const trades = db.prepare(`
      SELECT
        id, timestamp, direction, confidence, edge,
        entry_price as entryPrice, stake, pnl, outcome, strategy,
        btc_price_entry as btcPriceEntry, btc_price_close as btcPriceClose
      FROM trades
      WHERE mode = ?
      ORDER BY timestamp DESC
      LIMIT ?
      OFFSET ?
    `).all(activeMode, limit, offset);

        db.close();

        return NextResponse.json({
            trades,
            total: totalRow.total,
            limit,
            offset,
            mode: activeMode,
            hasMore: offset + trades.length < totalRow.total,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
