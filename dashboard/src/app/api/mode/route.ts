import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { getBotProcessStatus } from '@/lib/bot-process';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const MODES = ['PAPER', 'LIVE'] as const;
type TradingMode = typeof MODES[number];

function getDb(readonly = false) {
    try {
        return new Database(DB_PATH, { readonly });
    } catch {
        return null;
    }
}

function normalizeMode(value: string | null | undefined): TradingMode {
    const upper = (value || '').toUpperCase();
    return upper === 'LIVE' ? 'LIVE' : 'PAPER';
}

export async function GET() {
    const db = getDb(true);
    if (!db) {
        return NextResponse.json({
            mode: normalizeMode(process.env.TRADING_MODE),
            availableModes: MODES,
        });
    }

    try {
        const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get('trading_mode_active') as { value?: string } | undefined;
        db.close();
        return NextResponse.json({
            mode: normalizeMode(row?.value || process.env.TRADING_MODE),
            availableModes: MODES,
        });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const processStatus = getBotProcessStatus();
    if (processStatus.running) {
        return NextResponse.json(
            { error: 'Stop bot process before changing mode' },
            { status: 409 }
        );
    }

    const db = getDb(false);
    if (!db) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    try {
        const body = await request.json() as { mode?: string };
        const mode = normalizeMode(body.mode);
        if (!MODES.includes(mode)) {
            db.close();
            return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
        }

        db.prepare(
            `INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('trading_mode_active', ?, ?)`
        ).run(mode, Date.now());

        db.close();
        return NextResponse.json({ ok: true, mode });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
