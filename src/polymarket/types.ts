// ============================================
// Polymarket BTC Bot — Polymarket-Specific Types
// ============================================

/**
 * Raw Polymarket API response for a market/event.
 * Based on the CLOB API documentation.
 * Fields marked with TODO may need adjustment based on actual API responses.
 */
export interface RawPolymarketMarket {
    condition_id: string;
    question_id?: string;
    slug?: string;
    question: string;
    description?: string;
    tokens: Array<{
        token_id: string;
        outcome: string;  // "Yes" or "No"
        price: number;
    }>;
    active: boolean;
    closed: boolean;
    end_date_iso?: string;
    market_slug?: string;
    category?: string;
    tags?: string[];
}

/**
 * Raw orderbook response from CLOB API.
 */
export interface RawOrderbook {
    market: string;
    asset_id: string;
    hash: string;
    timestamp: string;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
}

/**
 * Raw order response from CLOB API.
 */
export interface RawOrderResponse {
    orderID: string;
    status: string;
    transactionsHashes?: string[];
}

/**
 * Request body for placing an order via CLOB API.
 */
export interface RawOrderRequest {
    order: {
        salt: string;
        maker: string;
        signer: string;
        taker: string;
        tokenId: string;
        makerAmount: string;
        takerAmount: string;
        side: 'BUY' | 'SELL';
        expiration: string;
        nonce: string;
        feeRateBps: string;
        signatureType: number;
        signature: string;
    };
    orderType: 'FOK' | 'GTC' | 'GTD';
}
