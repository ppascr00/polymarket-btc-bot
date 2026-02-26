export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const BINANCE_REST_URL = process.env.BINANCE_REST_URL || 'https://api.binance.us';
const BINANCE_SYMBOL = (process.env.BINANCE_SYMBOL || 'BTCUSDT').toUpperCase();

function getDb() {
    try {
        return new Database(DB_PATH, { readonly: true });
    } catch {
        return null;
    }
}

async function getPriceFromBinance() {
    const url = `${BINANCE_REST_URL}/api/v3/ticker/price?symbol=${BINANCE_SYMBOL}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Binance REST error: ${response.status}`);
    }

    const body = await response.json() as { price?: string };
    const price = Number(body.price);
    if (!Number.isFinite(price)) {
        throw new Error('Invalid Binance price payload');
    }

    return price;
}

function getPriceFromDbFallback() {
    const db = getDb();
    if (!db) return null;
    try {
        const row = db
            .prepare('SELECT close as price, timestamp FROM candles_1m ORDER BY timestamp DESC LIMIT 1')
            .get() as { price?: number; timestamp?: number } | undefined;
        db.close();

        if (!row || !Number.isFinite(row.price)) return null;
        return {
            price: Number(row.price),
            timestamp: Number(row.timestamp ?? Date.now()),
        };
    } catch {
        try { db.close(); } catch { }
        return null;
    }
}

export async function GET() {
    try {
        const price = await getPriceFromBinance();
        return NextResponse.json({
            symbol: BINANCE_SYMBOL,
            price,
            timestamp: Date.now(),
            source: 'binance-rest',
        });
    } catch {
        const fallback = getPriceFromDbFallback();
        if (fallback) {
            return NextResponse.json({
                symbol: BINANCE_SYMBOL,
                price: fallback.price,
                timestamp: fallback.timestamp,
                source: 'db-fallback',
            });
        }

        return NextResponse.json(
            {
                symbol: BINANCE_SYMBOL,
                price: null,
                timestamp: Date.now(),
                source: 'unavailable',
            },
            { status: 503 }
        );
    }
}

