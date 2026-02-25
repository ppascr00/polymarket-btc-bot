// ============================================
// Polymarket BTC Bot — Mock Polymarket Client
// ============================================
// Full mock implementation for PAPER mode and testing.
// Returns realistic fixture data simulating the BTC 5m market.

import { getLogger } from '../utils/logger.js';
import type {
    PolymarketClient as IPolymarketClient,
    PolymarketMarket,
    Orderbook,
    OrderParams,
    OrderResult,
    PolymarketOrder,
    PolymarketPosition,
} from '../types/index.js';

const logger = getLogger();

/**
 * Mock Polymarket client for PAPER mode.
 * Simulates a BTC 5m Up/Down market with configurable prices.
 */
export class PolymarketMockClient implements IPolymarketClient {
    private yesPrice: number;
    private orders: Map<string, PolymarketOrder> = new Map();
    private positions: PolymarketPosition[] = [];
    private orderCounter = 0;

    /**
     * @param initialYesPrice - Initial implied probability for YES (default 0.50)
     */
    constructor(initialYesPrice: number = 0.50) {
        this.yesPrice = initialYesPrice;
    }

    /**
     * Set the simulated YES price (for dynamic paper trading).
     */
    setYesPrice(price: number): void {
        this.yesPrice = Math.max(0.01, Math.min(0.99, price));
    }

    async findMarket(slug: string): Promise<PolymarketMarket | null> {
        logger.info({ slug, mode: 'MOCK' }, 'Mock: Finding market');

        return {
            conditionId: 'mock-condition-btc-5m-updown',
            slug: slug,
            question: 'Will the price of Bitcoin go up in the next 5 minutes?',
            yesTokenId: 'mock-yes-token-btc-5m',
            noTokenId: 'mock-no-token-btc-5m',
            active: true,
            endDate: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        };
    }

    async getOrderbook(tokenId: string): Promise<Orderbook> {
        const isYes = tokenId.includes('yes');
        const basePrice = isYes ? this.yesPrice : 1 - this.yesPrice;

        // Simulate a realistic orderbook with spread
        const spread = 0.02 + Math.random() * 0.03; // 2-5 cent spread
        const bestBid = basePrice - spread / 2;
        const bestAsk = basePrice + spread / 2;

        return {
            bids: [
                { price: Math.max(0.01, bestBid), size: 50 + Math.random() * 200 },
                { price: Math.max(0.01, bestBid - 0.01), size: 100 + Math.random() * 300 },
                { price: Math.max(0.01, bestBid - 0.02), size: 200 + Math.random() * 500 },
            ],
            asks: [
                { price: Math.min(0.99, bestAsk), size: 50 + Math.random() * 200 },
                { price: Math.min(0.99, bestAsk + 0.01), size: 100 + Math.random() * 300 },
                { price: Math.min(0.99, bestAsk + 0.02), size: 200 + Math.random() * 500 },
            ],
            midPrice: basePrice,
            spread: spread,
            timestamp: Date.now(),
        };
    }

    async getMidPrice(tokenId: string): Promise<number> {
        const isYes = tokenId.includes('yes');
        return isYes ? this.yesPrice : 1 - this.yesPrice;
    }

    async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
        this.orderCounter++;
        const orderId = `mock-order-${this.orderCounter}-${Date.now()}`;

        logger.info(
            {
                orderId,
                tokenId: params.tokenId,
                side: params.side,
                price: params.price,
                size: params.size,
                mode: 'MOCK',
            },
            'Mock: Order placed'
        );

        // Simulate immediate fill at requested price (paper mode)
        const order: PolymarketOrder = {
            orderId,
            tokenId: params.tokenId,
            side: params.side,
            price: params.price,
            size: params.size,
            filledSize: params.size,
            status: 'FILLED',
            timestamp: Date.now(),
        };

        this.orders.set(orderId, order);

        return {
            orderId,
            status: 'FILLED',
            filledSize: params.size,
            filledPrice: params.price,
            timestamp: Date.now(),
        };
    }

    async getOpenOrders(): Promise<PolymarketOrder[]> {
        return Array.from(this.orders.values()).filter(
            (o) => o.status === 'OPEN'
        );
    }

    async getPositions(): Promise<PolymarketPosition[]> {
        return [...this.positions];
    }

    async cancelOrder(orderId: string): Promise<boolean> {
        const order = this.orders.get(orderId);
        if (order && order.status === 'OPEN') {
            order.status = 'CANCELLED';
            logger.info({ orderId, mode: 'MOCK' }, 'Mock: Order cancelled');
            return true;
        }
        return false;
    }
}
