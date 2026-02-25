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

export async function POST(request: Request) {
    const db = getDb(false);
    if (!db) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    try {
        const body = await request.json() as { paused?: boolean };
        if (typeof body.paused !== 'boolean') {
            db.close();
            return NextResponse.json(
                { error: 'Invalid payload. Expected: { paused: boolean }' },
                { status: 400 }
            );
        }

        db.prepare(
            `INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('paused', ?, ?)`
        ).run(String(body.paused), Date.now());

        db.close();
        return NextResponse.json({ ok: true, paused: body.paused });
    } catch (err) {
        try { db.close(); } catch { }
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
