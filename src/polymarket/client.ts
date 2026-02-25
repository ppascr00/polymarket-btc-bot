// ============================================
// Polymarket BTC Bot — Real Polymarket CLOB Client
// ============================================
// Adapter wrapping the Polymarket CLOB API.
//
// IMPORTANT: This uses the documented CLOB API endpoints.
// Some details (token IDs, exact slug matching) may need
// adjustment when first connecting to a real BTC 5m market.
// All TODOs are marked clearly.

import { getLogger } from '../utils/logger.js';
import { resolvePolymarketApiCreds } from './credentials.js';
import type {
    PolymarketClient as IPolymarketClient,
    PolymarketMarket,
    Orderbook,
    OrderbookLevel,
    OrderParams,
    OrderResult,
    PolymarketOrder,
    PolymarketPosition,
    BotConfig,
} from '../types/index.js';

const logger = getLogger();

/**
 * Real Polymarket CLOB client.
 *
 * For LIVE mode, this connects to the actual Polymarket CLOB API.
 * Authentication uses L1 (EIP-712 private key signing) for order signing
 * and L2 (HMAC-SHA256 API credentials) for authenticated endpoints.
 *
 * Public endpoints (markets, orderbook, prices) do NOT require auth.
 *
 * TODO: For full production use, integrate the official
 * @polymarket/clob-client npm package for proper order signing.
 * This implementation provides the HTTP-level integration and
 * can be enhanced with the SDK for cryptographic order placement.
 */
export class PolymarketCLOBClient implements IPolymarketClient {
    private config: BotConfig;
    private apiUrl: string;
    private apiKey: string;
    private apiSecret: string;
    private apiPassphrase: string;
    private privateKey: string;
    private credsReady = false;

    constructor(config: BotConfig) {
        this.config = config;
        this.apiUrl = config.polymarket.apiUrl;
        this.apiKey = config.polymarket.apiKey;
        this.apiSecret = config.polymarket.apiSecret;
        this.apiPassphrase = config.polymarket.apiPassphrase;
        this.privateKey = config.polymarket.privateKey;
    }

    /**
     * Find a market by slug or partial match.
     * Uses the public Gamma Markets API to search.
     *
     * Endpoint: GET /markets?slug=<slug>
     * (No authentication required)
     */
    async findMarket(slug: string): Promise<PolymarketMarket | null> {
        try {
            // The CLOB API /markets endpoint returns paginated markets.
            // We fetch and filter by slug. For the BTC 5m market,
            // the slug pattern is typically: "bitcoin-5min-up-or-down" or similar.
            const url = `${this.apiUrl}/markets?next_cursor=MA==`;

            logger.info({ slug, url }, 'Searching for Polymarket market');

            const response = await fetch(url);
            if (!response.ok) {
                logger.error(
                    { status: response.status },
                    'Failed to fetch markets'
                );
                return null;
            }

            const data = await response.json() as {
                data?: Array<{
                    condition_id: string;
                    question: string;
                    tokens: Array<{ token_id: string; outcome: string }>;
                    active: boolean;
                    closed: boolean;
                    end_date_iso?: string;
                    market_slug?: string;
                }>;
                next_cursor?: string;
            };

            // Search for matching market
            // TODO: The exact slug/question pattern for BTC 5m Up/Down markets
            // needs to be verified against the live API. The market may be
            // identified by condition_id rather than slug.
            const markets = data.data ?? [];
            const match = markets.find(
                (m) =>
                    (m.market_slug && m.market_slug.includes(slug)) ||
                    m.question.toLowerCase().includes('bitcoin') &&
                    m.question.toLowerCase().includes('5') &&
                    (m.question.toLowerCase().includes('up') || m.question.toLowerCase().includes('down'))
            );

            if (!match) {
                logger.warn({ slug }, 'Market not found');
                return null;
            }

            const yesToken = match.tokens.find(
                (t) => t.outcome.toLowerCase() === 'yes'
            );
            const noToken = match.tokens.find(
                (t) => t.outcome.toLowerCase() === 'no'
            );

            if (!yesToken || !noToken) {
                logger.error('Market found but missing YES/NO tokens');
                return null;
            }

            return {
                conditionId: match.condition_id,
                slug: match.market_slug ?? slug,
                question: match.question,
                yesTokenId: yesToken.token_id,
                noTokenId: noToken.token_id,
                active: match.active && !match.closed,
                endDate: match.end_date_iso ?? '',
            };
        } catch (err) {
            logger.error({ err, slug }, 'Error finding market');
            return null;
        }
    }

    /**
     * Get the orderbook for a specific token.
     *
     * Endpoint: GET /book?token_id=<tokenId>
     * (No authentication required)
     */
    async getOrderbook(tokenId: string): Promise<Orderbook> {
        const url = `${this.apiUrl}/book?token_id=${tokenId}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to get orderbook: ${response.status}`);
        }

        const data = await response.json() as {
            bids: Array<{ price: string; size: string }>;
            asks: Array<{ price: string; size: string }>;
        };

        const bids: OrderbookLevel[] = (data.bids ?? [])
            .map((b) => ({
                price: parseFloat(b.price),
                size: parseFloat(b.size),
            }))
            .sort((a, b) => b.price - a.price);

        const asks: OrderbookLevel[] = (data.asks ?? [])
            .map((a) => ({
                price: parseFloat(a.price),
                size: parseFloat(a.size),
            }))
            .sort((a, b) => a.price - b.price);

        const bestBid = bids[0]?.price ?? 0;
        const bestAsk = asks[0]?.price ?? 1;
        const midPrice = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;

        return {
            bids,
            asks,
            midPrice,
            spread,
            timestamp: Date.now(),
        };
    }

    /**
     * Get the mid price for a token.
     *
     * Endpoint: GET /midpoint?token_id=<tokenId>
     * (No authentication required)
     */
    async getMidPrice(tokenId: string): Promise<number> {
        try {
            const url = `${this.apiUrl}/midpoint?token_id=${tokenId}`;
            const response = await fetch(url);
            if (!response.ok) {
                // Fallback: compute from orderbook
                const ob = await this.getOrderbook(tokenId);
                return ob.midPrice;
            }
            const data = await response.json() as { mid: string };
            return parseFloat(data.mid);
        } catch {
            const ob = await this.getOrderbook(tokenId);
            return ob.midPrice;
        }
    }

    /**
     * Place a limit order.
     *
     * Endpoint: POST /order
     * (Requires L2 authentication + order signing)
     *
     * TODO: Implement full EIP-712 order signing using @polymarket/clob-client SDK.
     * The current implementation shows the HTTP request structure but needs
     * the cryptographic signing layer for real order placement.
     */
    async placeLimitOrder(params: OrderParams): Promise<OrderResult> {
        await this.ensureApiCredentials();
        logger.info(
            {
                tokenId: params.tokenId,
                side: params.side,
                price: params.price,
                size: params.size,
            },
            'Placing limit order on Polymarket'
        );

        // TODO: In production, use @polymarket/clob-client to:
        // 1. Create a signed order using the private key (L1 auth)
        // 2. Submit the signed order with L2 HMAC headers
        //
        // Example with SDK (install @polymarket/clob-client):
        // ```
        // import { ClobClient } from '@polymarket/clob-client';
        // const client = new ClobClient(apiUrl, chainId, signer, creds);
        // const order = await client.createAndPostOrder({
        //   tokenID: params.tokenId,
        //   price: params.price,
        //   side: params.side,
        //   size: params.size,
        // });
        // ```

        if (!this.apiKey || !this.privateKey) {
            throw new Error(
                'Cannot place real orders without POLYMARKET_PRIVATE_KEY and API credentials. ' +
                'Use PAPER mode or configure credentials in .env'
            );
        }

        // HTTP structure for reference (signing needed):
        const url = `${this.apiUrl}/order`;

        // This is a simplified representation. Real implementation requires:
        // - EIP-712 typed data signing
        // - Proper salt, nonce, expiration handling
        // - HMAC-SHA256 headers for L2 auth
        throw new Error(
            'Real order placement requires @polymarket/clob-client SDK integration. ' +
            'See TODO in polymarket/client.ts for implementation guide. ' +
            'Install: npm install @polymarket/clob-client'
        );
    }

    /**
     * Get open orders.
     *
     * Endpoint: GET /orders?market=<conditionId>&status=open
     * (Requires L2 authentication)
     */
    async getOpenOrders(): Promise<PolymarketOrder[]> {
        await this.ensureApiCredentials();
        // TODO: Implement with L2 auth headers
        logger.warn('getOpenOrders not fully implemented — requires L2 auth');
        return [];
    }

    /**
     * Get current positions.
     *
     * Endpoint: GET /positions
     * (Requires L2 authentication)
     */
    async getPositions(): Promise<PolymarketPosition[]> {
        await this.ensureApiCredentials();
        // TODO: Implement with L2 auth headers
        logger.warn('getPositions not fully implemented — requires L2 auth');
        return [];
    }

    /**
     * Cancel an order by ID.
     *
     * Endpoint: DELETE /order/<orderId>
     * (Requires L2 authentication)
     */
    async cancelOrder(orderId: string): Promise<boolean> {
        await this.ensureApiCredentials();
        // TODO: Implement with L2 auth headers
        logger.warn({ orderId }, 'cancelOrder not fully implemented — requires L2 auth');
        return false;
    }

    private async ensureApiCredentials(): Promise<void> {
        if (this.credsReady) return;
        if (!this.privateKey) return;

        if (this.apiKey && this.apiSecret && this.apiPassphrase) {
            this.credsReady = true;
            return;
        }

        const creds = await resolvePolymarketApiCreds(this.config);
        this.apiKey = creds.key;
        this.apiSecret = creds.secret;
        this.apiPassphrase = creds.passphrase;
        this.credsReady = true;
        logger.info('Polymarket API credentials derived at runtime');
    }
}
