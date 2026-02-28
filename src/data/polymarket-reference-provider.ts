// ============================================
// Polymarket BTC Bot - Polymarket Reference Provider
// ============================================
// Uses Polymarket's reference Chainlink stream endpoint as BTC/USD source.
// It polls the stream and builds synthetic 1m candles for the bot pipeline.

import { getLogger } from '../utils/logger.js';
import type { BotConfig, Candle, ExchangeDataProvider } from '../types/index.js';

const logger = getLogger();

type ChainlinkNode = {
    valueNumeric?: string;
    validAfterTs?: string;
    attributeName?: string;
};

type ChainlinkPayload = {
    data?: {
        allStreamValuesGenerics?: {
            nodes?: ChainlinkNode[];
        };
    };
};

type PricePoint = {
    price: number;
    timestamp: number;
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

export class PolymarketReferenceProvider implements ExchangeDataProvider {
    private candleCallbacks: Array<(candle: Candle) => void> = [];
    private connected = false;
    private running = false;
    private lastMessageTime = 0;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private currentCandle: Candle | null = null;
    private history: Candle[] = [];
    private pricePoints: PricePoint[] = [];

    private readonly streamApiUrl: string;
    private readonly btcFeedId: string;
    private readonly pollMs: number;
    private readonly timeoutMs: number;
    private readonly historyLimit: number;
    private readonly priceHistoryLimit: number;

    constructor(_config: BotConfig) {
        this.streamApiUrl =
            process.env.POLYMARKET_CHAINLINK_STREAM_API_URL ??
            'https://data.chain.link/api/live-data-engine-streams-data';
        this.btcFeedId = (
            process.env.POLYMARKET_CHAINLINK_BTC_FEED_ID ??
            '0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8'
        ).toLowerCase();
        this.pollMs = Math.max(
            500,
            Number(process.env.POLYMARKET_PRICE_POLL_MS ?? '500')
        );
        this.timeoutMs = Math.max(
            1000,
            Number(process.env.POLYMARKET_PRICE_TIMEOUT_MS ?? '5000')
        );
        this.historyLimit = Math.max(
            120,
            Number(process.env.POLYMARKET_HISTORY_CANDLE_LIMIT ?? '5000')
        );
        this.priceHistoryLimit = Math.max(
            300,
            Number(process.env.POLYMARKET_PRICE_HISTORY_LIMIT ?? '50000')
        );
    }

    async connect(): Promise<void> {
        if (this.running) return;

        this.running = true;
        logger.info(
            {
                url: this.streamApiUrl,
                pollMs: this.pollMs,
                feedId: this.btcFeedId,
            },
            'Connecting to Polymarket reference feed'
        );

        try {
            const point = await this.fetchLatestPrice();
            this.onPricePoint(point);
            this.connected = true;
            this.lastMessageTime = Date.now();
            logger.info({ price: point.price }, 'Polymarket reference feed connected');
        } catch (err) {
            this.connected = false;
            logger.warn(
                { err },
                'Initial Polymarket reference fetch failed. Will keep retrying.'
            );
        }

        this.scheduleNextPoll();
    }

    async disconnect(): Promise<void> {
        this.running = false;
        this.connected = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        logger.info('Polymarket reference provider disconnected');
    }

    onCandle(callback: (candle: Candle) => void): void {
        this.candleCallbacks.push(callback);
    }

    async getHistoricalCandles(
        _symbol: string,
        interval: string,
        start: number,
        end: number
    ): Promise<Candle[]> {
        if (interval !== '1m') {
            logger.warn(
                { interval },
                'Polymarket reference provider only supports synthetic 1m candles'
            );
        }

        const rows = this.history.filter(
            (c) => c.timestamp >= start && c.timestamp < end
        );

        if (
            rows.length === 0 &&
            this.currentCandle &&
            this.currentCandle.timestamp >= start &&
            this.currentCandle.timestamp < end
        ) {
            rows.push({ ...this.currentCandle });
        }

        return rows;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getLatency(): number {
        if (!this.connected || this.lastMessageTime === 0) return Infinity;
        return Date.now() - this.lastMessageTime;
    }

    getPriceNear(
        timestamp: number,
        options?: {
            direction?: 'before' | 'after' | 'nearest';
            maxDiffMs?: number;
        }
    ): number | null {
        if (this.pricePoints.length === 0) return null;

        const direction = options?.direction ?? 'nearest';
        const maxDiffMs = options?.maxDiffMs ?? 120_000;

        let best: PricePoint | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;

        if (direction === 'before') {
            for (let i = this.pricePoints.length - 1; i >= 0; i--) {
                const p = this.pricePoints[i]!;
                if (p.timestamp <= timestamp) {
                    best = p;
                    bestDiff = timestamp - p.timestamp;
                    break;
                }
            }
        } else if (direction === 'after') {
            for (let i = 0; i < this.pricePoints.length; i++) {
                const p = this.pricePoints[i]!;
                if (p.timestamp >= timestamp) {
                    best = p;
                    bestDiff = p.timestamp - timestamp;
                    break;
                }
            }
        } else {
            for (const p of this.pricePoints) {
                const diff = Math.abs(p.timestamp - timestamp);
                if (diff < bestDiff) {
                    best = p;
                    bestDiff = diff;
                }
            }
        }

        if (!best || bestDiff > maxDiffMs) return null;
        return best.price;
    }

    private scheduleNextPoll(): void {
        if (!this.running) return;
        this.pollTimer = setTimeout(() => {
            void this.pollOnce();
        }, this.pollMs);
    }

    private async pollOnce(): Promise<void> {
        if (!this.running) return;

        try {
            const point = await this.fetchLatestPrice();
            this.onPricePoint(point);
            this.connected = true;
            this.lastMessageTime = Date.now();
        } catch (err) {
            this.connected = false;
            logger.warn({ err }, 'Polymarket reference poll failed');
        } finally {
            this.scheduleNextPoll();
        }
    }

    private async fetchLatestPrice(): Promise<PricePoint> {
        const feedIds = encodeURIComponent(JSON.stringify([this.btcFeedId]));
        const url = `${this.streamApiUrl}?feedIds=${feedIds}&abiIndex=0`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`Chainlink stream error: ${response.status}`);
            }

            const payload = (await response.json()) as ChainlinkPayload;
            const point = this.extractPricePoint(payload);
            if (!point) {
                throw new Error('Invalid Chainlink stream payload');
            }
            return point;
        } finally {
            clearTimeout(timeout);
        }
    }

    private extractPricePoint(payload: ChainlinkPayload): PricePoint | null {
        const nodes = payload.data?.allStreamValuesGenerics?.nodes ?? [];
        if (!Array.isArray(nodes) || nodes.length === 0) return null;

        const benchmarkNodes = nodes
            .filter(
                (n) => (n.attributeName ?? '').toLowerCase() === 'benchmark'
            )
            .sort(
                (a, b) => toTimestampMs(b.validAfterTs) - toTimestampMs(a.validAfterTs)
            );

        const benchmark = benchmarkNodes[0];
        const benchmarkPrice = toFinitePrice(benchmark?.valueNumeric);
        if (benchmark && benchmarkPrice !== null) {
            return {
                price: benchmarkPrice,
                timestamp: toTimestampMs(benchmark.validAfterTs) || Date.now(),
            };
        }

        const latestTs = nodes.reduce((acc, curr) => {
            return Math.max(acc, toTimestampMs(curr.validAfterTs));
        }, 0);
        const latestNodes = nodes.filter(
            (n) => toTimestampMs(n.validAfterTs) === latestTs
        );

        const bidNode = latestNodes.find(
            (n) => (n.attributeName ?? '').toLowerCase() === 'bid'
        );
        const askNode = latestNodes.find(
            (n) => (n.attributeName ?? '').toLowerCase() === 'ask'
        );
        const bid = toFinitePrice(bidNode?.valueNumeric);
        const ask = toFinitePrice(askNode?.valueNumeric);

        if (bid !== null && ask !== null) {
            return {
                price: (bid + ask) / 2,
                timestamp: latestTs || Date.now(),
            };
        }

        const fallbackNode = nodes.find(
            (n) => toFinitePrice(n.valueNumeric) !== null
        );
        const fallbackPrice = toFinitePrice(fallbackNode?.valueNumeric);
        if (fallbackNode && fallbackPrice !== null) {
            return {
                price: fallbackPrice,
                timestamp: toTimestampMs(fallbackNode.validAfterTs) || Date.now(),
            };
        }

        return null;
    }

    private onPricePoint(point: PricePoint): void {
        this.recordPricePoint(point);

        const minuteStart = Math.floor(point.timestamp / 60_000) * 60_000;

        if (!this.currentCandle) {
            this.currentCandle = this.createCandle(minuteStart, point.price);
            return;
        }

        if (minuteStart < this.currentCandle.timestamp) {
            logger.debug(
                { pointTs: point.timestamp, candleTs: this.currentCandle.timestamp },
                'Out-of-order price point ignored'
            );
            return;
        }

        if (minuteStart === this.currentCandle.timestamp) {
            this.currentCandle.high = Math.max(this.currentCandle.high, point.price);
            this.currentCandle.low = Math.min(this.currentCandle.low, point.price);
            this.currentCandle.close = point.price;
            return;
        }

        // Close and emit current candle when a new minute starts.
        const finalized = { ...this.currentCandle };
        this.publishCandle(finalized);

        // Gap-fill missing full minutes with flat candles using last close.
        let gapStart = this.currentCandle.timestamp + 60_000;
        while (gapStart < minuteStart) {
            const filler = this.createCandle(
                gapStart,
                this.currentCandle.close,
                'polymarket-chainlink-gapfill'
            );
            this.publishCandle(filler);
            gapStart += 60_000;
        }

        this.currentCandle = this.createCandle(minuteStart, point.price);
    }

    private recordPricePoint(point: PricePoint): void {
        const last = this.pricePoints[this.pricePoints.length - 1];
        if (last && point.timestamp < last.timestamp) {
            // Keep series monotonic for binary-friendly scans.
            return;
        }

        if (last && point.timestamp === last.timestamp) {
            last.price = point.price;
            return;
        }

        this.pricePoints.push(point);
        if (this.pricePoints.length > this.priceHistoryLimit) {
            this.pricePoints = this.pricePoints.slice(-this.priceHistoryLimit);
        }
    }

    private createCandle(
        timestamp: number,
        price: number,
        source: string = 'polymarket-chainlink'
    ): Candle {
        return {
            timestamp,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
            source,
        };
    }

    private publishCandle(candle: Candle): void {
        this.history.push(candle);
        if (this.history.length > this.historyLimit) {
            this.history = this.history.slice(-this.historyLimit);
        }

        for (const cb of this.candleCallbacks) {
            cb(candle);
        }

        logger.debug(
            { ts: candle.timestamp, close: candle.close, source: candle.source },
            'Synthetic candle emitted'
        );
    }
}
