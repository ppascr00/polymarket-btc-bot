// ============================================
// Polymarket BTC Bot — Execution Engine
// ============================================
// Handles both PAPER and LIVE order placement.

import { getLogger } from '../utils/logger.js';
import type {
    ExecutionEngine as IExecutionEngine,
    Signal,
    MarketState,
    TradeRecord,
    PolymarketClient,
    BotConfig,
} from '../types/index.js';

const logger = getLogger();

export class DefaultExecutionEngine implements IExecutionEngine {
    private mode: 'PAPER' | 'LIVE';
    private client: PolymarketClient;

    constructor(config: BotConfig, client: PolymarketClient) {
        this.mode = config.tradingMode;
        this.client = client;
    }

    getMode(): 'PAPER' | 'LIVE' {
        return this.mode;
    }

    async execute(
        signal: Signal,
        marketState: MarketState,
        stake: number,
        btcPrice: number
    ): Promise<TradeRecord> {
        const isUp = signal.direction === 'UP';

        // Determine which token to buy
        const tokenId = isUp
            ? marketState.market.yesTokenId
            : marketState.market.noTokenId;

        const orderbook = isUp
            ? marketState.yesOrderbook
            : marketState.noOrderbook;

        // Price: use best ask (we're buying)
        const bestAsk = orderbook.asks[0]?.price ?? (isUp ? 0.55 : 0.55);

        // Check spread tolerance
        if (orderbook.spread > 0.10) {
            logger.warn(
                { spread: orderbook.spread },
                'Spread too wide, but proceeding as risk manager already approved'
            );
        }

        // Calculate size based on stake and price
        const size = stake / bestAsk;

        logger.info(
            {
                mode: this.mode,
                direction: signal.direction,
                tokenId,
                price: bestAsk,
                size: size.toFixed(2),
                stake,
            },
            'Executing trade'
        );

        try {
            const result = await this.client.placeLimitOrder({
                tokenId,
                side: 'BUY',
                price: bestAsk,
                size,
                orderType: 'LIMIT',
            });

            const trade: TradeRecord = {
                timestamp: Date.now(),
                windowStart: 0, // Will be set by scheduler
                mode: this.mode,
                strategy: signal.strategyName,
                direction: signal.direction,
                confidence: signal.confidence,
                edge: signal.edge,
                entryPrice: result.filledPrice || bestAsk,
                marketYesPrice: marketState.yesPrice,
                marketNoPrice: marketState.noPrice,
                stake,
                pnl: 0,
                outcome: 'PENDING',
                reasons: signal.reasons,
                btcPriceEntry: btcPrice,
            };

            logger.info(
                {
                    orderId: result.orderId,
                    status: result.status,
                    filledSize: result.filledSize,
                    filledPrice: result.filledPrice,
                },
                'Trade executed'
            );

            return trade;
        } catch (err) {
            logger.error({ err, direction: signal.direction }, 'Trade execution failed');

            // Return a failed trade record
            return {
                timestamp: Date.now(),
                windowStart: 0,
                mode: this.mode,
                strategy: signal.strategyName,
                direction: signal.direction,
                confidence: signal.confidence,
                edge: signal.edge,
                entryPrice: 0,
                marketYesPrice: marketState.yesPrice,
                marketNoPrice: marketState.noPrice,
                stake: 0,
                pnl: 0,
                outcome: 'LOSS',
                reasons: [...signal.reasons, `EXECUTION ERROR: ${String(err)}`],
                btcPriceEntry: btcPrice,
            };
        }
    }
}
