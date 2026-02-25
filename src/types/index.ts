// ============================================
// Polymarket BTC Bot — Shared Type Definitions
// ============================================

// --- Candle / OHLCV ---
export interface Candle {
    timestamp: number;    // unix ms, start of candle
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
}

// --- 5-Minute Feature Set ---
export interface FeatureSet {
    windowStart: number;  // unix ms
    windowEnd: number;
    open: number;
    close: number;
    ret1m: number;        // last 1m return
    ret5m: number;        // 5m return
    ema3: number;
    ema8: number;
    rsi14: number;
    volatility: number;   // realized vol
    rangeHL: number;      // (high - low) / open
    volume: number;
    obImbalance: number;  // orderbook imbalance (-1 to 1)
    spread: number;       // bid-ask spread
    midChange: number;    // change in mid price
}

// --- Strategy Signal ---
export type Direction = 'UP' | 'DOWN' | 'NO_TRADE';

export interface Signal {
    direction: Direction;
    confidence: number;   // 0–1
    pUp: number;          // estimated P(BTC goes up)
    edge: number;         // expected edge vs market price
    reasons: string[];    // human-readable explanations
    strategyName: string;
    timestamp: number;
}

// --- Polymarket Types ---
export interface PolymarketMarket {
    conditionId: string;
    slug: string;
    question: string;
    yesTokenId: string;
    noTokenId: string;
    active: boolean;
    endDate: string;
}

export interface OrderbookLevel {
    price: number;
    size: number;
}

export interface Orderbook {
    bids: OrderbookLevel[];  // sorted descending by price
    asks: OrderbookLevel[];  // sorted ascending by price
    midPrice: number;
    spread: number;
    timestamp: number;
}

export interface MarketState {
    market: PolymarketMarket;
    yesOrderbook: Orderbook;
    noOrderbook: Orderbook;
    yesPrice: number;        // best bid for YES
    noPrice: number;         // best bid for NO
    impliedProbUp: number;   // ~yesPrice, adjusted
}

export interface OrderParams {
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    orderType: 'LIMIT' | 'MARKET';
}

export interface OrderResult {
    orderId: string;
    status: 'FILLED' | 'PARTIAL' | 'OPEN' | 'REJECTED';
    filledSize: number;
    filledPrice: number;
    timestamp: number;
}

export interface PolymarketPosition {
    tokenId: string;
    side: string;
    size: number;
    avgPrice: number;
}

export interface PolymarketOrder {
    orderId: string;
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    filledSize: number;
    status: string;
    timestamp: number;
}

// --- Risk ---
export interface AccountState {
    balance: number;
    dailyPnL: number;
    openPositions: number;
    consecutiveLosses: number;
    tradesThisWindow: number;
}

export interface RiskDecision {
    allowed: boolean;
    reason: string;
    adjustedStake?: number;
}

// --- Trade ---
export type TradeOutcome = 'WIN' | 'LOSS' | 'PENDING';

export interface TradeRecord {
    id?: number;
    timestamp: number;
    windowStart: number;
    mode: 'PAPER' | 'LIVE';
    strategy: string;
    direction: Direction;
    confidence: number;
    edge: number;
    entryPrice: number;
    marketYesPrice: number;
    marketNoPrice: number;
    stake: number;
    pnl: number;
    outcome: TradeOutcome;
    reasons: string[];
    btcPriceEntry?: number;
    btcPriceClose?: number;
}

export interface StrategyWindowSignalRecord {
    id?: number;
    timestamp: number;
    windowStart: number;
    mode: 'PAPER' | 'LIVE';
    strategy: string;
    direction: Direction;
    confidence: number;
    pUp: number;
    edge: number;
    shouldTrade: boolean;
    decisionReason: string;
    reasons: string[];
    tradeId?: number | null;
}

// --- Backtest ---
export interface BacktestConfig {
    startDate: number;
    endDate: number;
    initialBalance: number;
    stakePerTrade: number;
    strategy: string;
    impliedProbModel: 'sigmoid' | 'fixed' | 'historical';
    commission: number;
}

export interface BacktestResult {
    trades: TradeRecord[];
    metrics: BacktestMetrics;
}

export interface BacktestMetrics {
    totalTrades: number;
    wins: number;
    losses: number;
    noTrades: number;
    hitRate: number;
    expectancy: number;
    totalPnL: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    profitFactor: number;
    avgEdge: number;
    avgConfidence: number;
}

// --- Config ---
export interface BotConfig {
    tradingMode: 'PAPER' | 'LIVE';
    strategy: string;

    binance: {
        wsUrl: string;
        restUrl: string;
        symbol: string;
    };

    polymarket: {
        apiUrl: string;
        privateKey: string;
        apiKey: string;
        apiSecret: string;
        apiPassphrase: string;
        funderAddress: string;
        signatureType: number;
        chainId: number;
        marketSlug: string;
    };

    risk: {
        maxStakePerTrade: number;
        maxDailyLoss: number;
        maxOpenPositions: number;
        cooldownAfterLosses: number;
        slippageTolerance: number;
        minEdgeThreshold: number;
        spreadMaxTolerance: number;
    };

    timing: {
        tradingCutoffSeconds: number;
        dataStaleTresholdSeconds: number;
        windowMinutes: number;
    };

    db: {
        path: string;
    };

    dashboard: {
        port: number;
        password: string;
    };

    logging: {
        level: string;
    };

    featureFlags: {
        autoPauseOnError: boolean;
        autoPauseOnStaleData: boolean;
        maxConsecutiveErrors: number;
    };
}

// --- Interfaces for dependency injection ---
export interface ExchangeDataProvider {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    onCandle(callback: (candle: Candle) => void): void;
    getHistoricalCandles(
        symbol: string,
        interval: string,
        start: number,
        end: number
    ): Promise<Candle[]>;
    isConnected(): boolean;
    getLatency(): number;
}

export interface PolymarketClient {
    findMarket(slug: string): Promise<PolymarketMarket | null>;
    getOrderbook(tokenId: string): Promise<Orderbook>;
    getMidPrice(tokenId: string): Promise<number>;
    placeLimitOrder(params: OrderParams): Promise<OrderResult>;
    getOpenOrders(): Promise<PolymarketOrder[]>;
    getPositions(): Promise<PolymarketPosition[]>;
    cancelOrder(orderId: string): Promise<boolean>;
}

export interface Strategy {
    readonly name: string;
    compute(features: FeatureSet, marketState: MarketState): Signal;
    train?(historicalData: FeatureSet[]): void;
}

export interface RiskManager {
    canTrade(signal: Signal, account: AccountState): RiskDecision;
    recordTrade(trade: TradeRecord): void;
    getDailyPnL(): number;
    getConsecutiveLosses(): number;
    isInCooldown(): boolean;
    resetDaily(): void;
}

export interface ExecutionEngine {
    execute(
        signal: Signal,
        marketState: MarketState,
        stake: number,
        btcPrice: number
    ): Promise<TradeRecord>;
    getMode(): 'PAPER' | 'LIVE';
}
