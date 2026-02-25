import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');

function getDb(readonly = false) {
    try {
        return new Database(DB_PATH, { readonly });
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

function isEnabledValue(raw: string | null | undefined): boolean {
    return raw === 'true';
}

export async function GET() {
    const db = getDb(true);
    if (!db) {
        return NextResponse.json({
            enabled: false,
            effective: false,
            mode: 'PAPER',
        });
    }

    try {
        const mode = getActiveMode(db);
        const row = db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get('paper_multi_enabled') as { value?: string } | undefined;

        db.close();
        const enabled = isEnabledValue(row?.value);
        return NextResponse.json({
            enabled,
            effective: mode === 'PAPER' && enabled,
            mode,
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
        const body = await request.json() as { enabled?: boolean };
        if (typeof body.enabled !== 'boolean') {
            db.close();
            return NextResponse.json(
                { error: 'Invalid payload. Expected: { enabled: boolean }' },
                { status: 400 }
            );
        }

        db.prepare(
            `INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('paper_multi_enabled', ?, ?)`
        ).run(String(body.enabled), Date.now());

        const mode = getActiveMode(db);
        db.close();

        return NextResponse.json({
            ok: true,
            enabled: body.enabled,
            effective: mode === 'PAPER' && body.enabled,
            mode,
        });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

