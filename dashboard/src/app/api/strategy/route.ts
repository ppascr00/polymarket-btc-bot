import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const AVAILABLE_STRATEGIES = [
    'probabilistic',
    'ema-crossover',
    'rsi-reversion',
    'volatility-breakout',
    'ai-adaptive',
];

function getDb(readonly = false) {
    try {
        return new Database(DB_PATH, { readonly });
    } catch {
        return null;
    }
}

export async function GET() {
    const db = getDb(true);
    if (!db) {
        return NextResponse.json({
            current: process.env.STRATEGY || 'probabilistic',
            available: AVAILABLE_STRATEGIES,
        });
    }

    try {
        const row = db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get('strategy_active') as { value?: string } | undefined;
        db.close();

        const current = row?.value || process.env.STRATEGY || 'probabilistic';
        return NextResponse.json({
            current,
            available: AVAILABLE_STRATEGIES,
        });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = getDb(false);
    if (!db) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    try {
        const body = await request.json() as { strategy?: string };
        const strategy = body.strategy || '';
        if (!AVAILABLE_STRATEGIES.includes(strategy)) {
            db.close();
            return NextResponse.json(
                {
                    error: `Unknown strategy "${strategy}"`,
                    available: AVAILABLE_STRATEGIES,
                },
                { status: 400 }
            );
        }

        db.prepare(
            `INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('strategy_active', ?, ?)`
        ).run(strategy, Date.now());

        db.close();
        return NextResponse.json({ ok: true, strategy });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
