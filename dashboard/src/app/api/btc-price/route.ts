export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve('..', 'data', 'bot.db');
const BINANCE_REST_URL = process.env.BINANCE_REST_URL || 'https://api.binance.us';
const BINANCE_SYMBOL = (process.env.BINANCE_SYMBOL || 'BTCUSDT').toUpperCase();
const CHAINLINK_STREAM_API_URL =
    process.env.POLYMARKET_CHAINLINK_STREAM_API_URL ||
    'https://data.chain.link/api/live-data-engine-streams-data';
const CHAINLINK_BTC_FEED_ID = (
    process.env.POLYMARKET_CHAINLINK_BTC_FEED_ID ||
    '0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8'
).toLowerCase();
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

type ChainlinkNode = {
    valueNumeric?: string;
    validAfterTs?: string;
    attributeName?: string;
};

function toTimestampMs(value: string | undefined): number {
    if (!value) return 0;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
}

function toFinitePrice(value: string | undefined): number | null {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}

async function getPriceFromPolymarketReferenceStream() {
    const feedIds = encodeURIComponent(JSON.stringify([CHAINLINK_BTC_FEED_ID]));
    const url = `${CHAINLINK_STREAM_API_URL}?feedIds=${feedIds}&abiIndex=0`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Chainlink stream error: ${response.status}`);
    }

    const body = await response.json() as {
        data?: {
            allStreamValuesGenerics?: {
                nodes?: ChainlinkNode[];
            };
        };
    };

    const nodes = body?.data?.allStreamValuesGenerics?.nodes ?? [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('Empty Chainlink stream payload');
    }

    const benchmarkNodes = nodes
        .filter((n) => (n.attributeName || '').toLowerCase() === 'benchmark')
        .sort((a, b) => toTimestampMs(b.validAfterTs) - toTimestampMs(a.validAfterTs));

    const benchmark = benchmarkNodes[0];
    const benchmarkPrice = toFinitePrice(benchmark?.valueNumeric);
    if (benchmark && benchmarkPrice !== null) {
        return {
            price: benchmarkPrice,
            timestamp: toTimestampMs(benchmark.validAfterTs) || Date.now(),
            source: 'polymarket-chainlink-stream',
        };
    }

    const latestTs = nodes.reduce((acc, curr) => {
        return Math.max(acc, toTimestampMs(curr.validAfterTs));
    }, 0);
    const latestNodes = nodes.filter((n) => toTimestampMs(n.validAfterTs) === latestTs);

    const bidNode = latestNodes.find((n) => (n.attributeName || '').toLowerCase() === 'bid');
    const askNode = latestNodes.find((n) => (n.attributeName || '').toLowerCase() === 'ask');
    const bid = toFinitePrice(bidNode?.valueNumeric);
    const ask = toFinitePrice(askNode?.valueNumeric);

    if (bid !== null && ask !== null) {
        return {
            price: (bid + ask) / 2,
            timestamp: latestTs || Date.now(),
            source: 'polymarket-chainlink-stream-mid',
        };
    }

    const fallbackNode = nodes.find((n) => toFinitePrice(n.valueNumeric) !== null);
    const fallbackPrice = toFinitePrice(fallbackNode?.valueNumeric);
    if (fallbackNode && fallbackPrice !== null) {
        return {
            price: fallbackPrice,
            timestamp: toTimestampMs(fallbackNode.validAfterTs) || Date.now(),
            source: 'polymarket-chainlink-stream-fallback',
        };
    }

    throw new Error('Invalid Chainlink stream payload');
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
        const chainlinkPrice = await getPriceFromPolymarketReferenceStream();
        return NextResponse.json(
            {
                symbol: 'BTC/USD',
                price: chainlinkPrice.price,
                timestamp: chainlinkPrice.timestamp,
                source: chainlinkPrice.source,
            },
            { headers: NO_CACHE_HEADERS }
        );
    } catch {
        try {
            const price = await getPriceFromBinanceBookTicker();
            return NextResponse.json(
                {
                    symbol: BINANCE_SYMBOL,
                    price,
                    timestamp: Date.now(),
                    source: 'binance-bookTicker-fallback',
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
                    symbol: 'BTC/USD',
                    price: null,
                    timestamp: Date.now(),
                    source: 'unavailable',
                },
                { status: 503, headers: NO_CACHE_HEADERS }
            );
        }
    }
}
