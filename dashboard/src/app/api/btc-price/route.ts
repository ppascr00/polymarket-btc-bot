export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const BINANCE_REST_URL = process.env.BINANCE_REST_URL || 'https://api.binance.us';
const BINANCE_SYMBOL = (process.env.BINANCE_SYMBOL || 'BTCUSDT').toUpperCase();
const NO_CACHE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
};

function getDb() {
    try {
        return new Database(DB_PATH, { readonly: true });
    } catch {
        return null;
    }
}

async function getPriceFromBinanceBookTicker() {
    const url = `${BINANCE_REST_URL}/api/v3/ticker/bookTicker?symbol=${BINANCE_SYMBOL}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Binance bookTicker error: ${response.status}`);
    }

    const body = await response.json() as { bidPrice?: string; askPrice?: string; price?: string };
    const bid = Number(body.bidPrice);
    const ask = Number(body.askPrice);
    const direct = Number(body.price);

    // Prefer bid/ask midpoint for fresher movement.
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        return (bid + ask) / 2;
    }
    if (Number.isFinite(direct) && direct > 0) {
        return direct;
    }
    throw new Error('Invalid Binance bookTicker payload');
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
        const price = await getPriceFromBinanceBookTicker();
        return NextResponse.json(
            {
                symbol: BINANCE_SYMBOL,
                price,
                timestamp: Date.now(),
                source: 'binance-bookTicker',
            },
            { headers: NO_CACHE_HEADERS }
        );
    } catch {
        const fallback = getPriceFromDbFallback();
        if (fallback) {
            return NextResponse.json(
                {
                    symbol: BINANCE_SYMBOL,
                    price: fallback.price,
                    timestamp: fallback.timestamp,
                    source: 'db-fallback',
                },
                { headers: NO_CACHE_HEADERS }
            );
        }

        return NextResponse.json(
            {
                symbol: BINANCE_SYMBOL,
                price: null,
                timestamp: Date.now(),
                source: 'unavailable',
            },
            { status: 503, headers: NO_CACHE_HEADERS }
        );
    }
}
