// ============================================
// Polymarket BTC Bot — Binance Exchange Provider
// ============================================
// Connects to Binance WebSocket for real-time BTC 1m klines.
// Falls back to REST API if WebSocket is disconnected.

import WebSocket from 'ws';
import { getLogger } from '../utils/logger.js';
import type { Candle, ExchangeDataProvider, BotConfig } from '../types/index.js';

const logger = getLogger();

export class BinanceProvider implements ExchangeDataProvider {
    private ws: WebSocket | null = null;
    private candleCallbacks: Array<(candle: Candle) => void> = [];
    private connected = false;
    private lastMessageTime = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 50;
    private symbol: string;
    private wsUrl: string;
    private restUrl: string;

    constructor(config: BotConfig) {
        this.symbol = config.binance.symbol.toLowerCase();
        this.wsUrl = config.binance.wsUrl;
        this.restUrl = config.binance.restUrl;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const streamUrl = `${this.wsUrl}/${this.symbol}@kline_1m`;

            logger.info({ url: streamUrl }, 'Connecting to Binance WebSocket');

            this.ws = new WebSocket(streamUrl);

            this.ws.on('open', () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                this.lastMessageTime = Date.now();
                logger.info('Binance WebSocket connected');
                resolve();
            });

            this.ws.on('message', (data: Buffer) => {
                this.lastMessageTime = Date.now();
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.e === 'kline') {
                        const k = msg.k;
                        // Only emit completed candles
                        if (k.x) {
                            const candle: Candle = {
                                timestamp: k.t,         // kline start time
                                open: parseFloat(k.o),
                                high: parseFloat(k.h),
                                low: parseFloat(k.l),
                                close: parseFloat(k.c),
                                volume: parseFloat(k.v),
                                source: 'binance',
                            };
                            for (const cb of this.candleCallbacks) {
                                cb(candle);
                            }
                            logger.debug(
                                { ts: candle.timestamp, close: candle.close },
                                'Candle received'
                            );
                        }
                    }
                } catch (err) {
                    logger.error({ err }, 'Error parsing Binance message');
                }
            });

            this.ws.on('close', (code, reason) => {
                this.connected = false;
                logger.warn(
                    { code, reason: reason.toString() },
                    'Binance WebSocket closed'
                );
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                this.connected = false;
                logger.error({ err }, 'Binance WebSocket error');
                if (this.reconnectAttempts === 0) {
                    reject(err);
                }
            });

            // Ping every 3 minutes to keep alive
            const pingInterval = setInterval(() => {
                if (this.ws && this.connected) {
                    this.ws.ping();
                } else {
                    clearInterval(pingInterval);
                }
            }, 180_000);
        });
    }

    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.ws) {
            this.ws.close(1000, 'Graceful shutdown');
            this.ws = null;
        }
        this.connected = false;
        logger.info('Binance WebSocket disconnected');
    }

    onCandle(callback: (candle: Candle) => void): void {
        this.candleCallbacks.push(callback);
    }

    async getHistoricalCandles(
        symbol: string,
        interval: string,
        start: number,
        end: number
    ): Promise<Candle[]> {
        // REST fallback: /api/v3/klines
        const url = new URL(`${this.restUrl}/api/v3/klines`);
        url.searchParams.set('symbol', symbol.toUpperCase());
        url.searchParams.set('interval', interval);
        url.searchParams.set('startTime', start.toString());
        url.searchParams.set('endTime', end.toString());
        url.searchParams.set('limit', '1000');

        logger.info({ url: url.toString() }, 'Fetching historical candles');

        const response = await fetch(url.toString());
        if (!response.ok) {
            throw new Error(
                `Binance REST error: ${response.status} ${response.statusText}`
            );
        }

        const data = (await response.json()) as Array<
            [number, string, string, string, string, string, ...unknown[]]
        >;

        return data.map((k) => ({
            timestamp: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            source: 'binance',
        }));
    }

    isConnected(): boolean {
        return this.connected;
    }

    getLatency(): number {
        if (!this.connected) return Infinity;
        return Date.now() - this.lastMessageTime;
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached. Giving up.');
            return;
        }

        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
        this.reconnectAttempts++;

        logger.info(
            { attempt: this.reconnectAttempts, delayMs: delay },
            'Scheduling WebSocket reconnect'
        );

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
            } catch (err) {
                logger.error({ err }, 'Reconnect failed');
            }
        }, delay);
    }
}
