const STRATEGY_ENV_KEYS: Record<string, string[]> = {
    'probabilistic': [
        'PROBABILISTIC_MIN_EDGE_THRESHOLD',
        'PROB_MIN_EDGE_THRESHOLD',
    ],
    'ema-crossover': [
        'EMA_CROSSOVER_MIN_EDGE_THRESHOLD',
        'EMA_MIN_EDGE_THRESHOLD',
    ],
    'rsi-reversion': [
        'RSI_REVERSION_MIN_EDGE_THRESHOLD',
        'RSI_MIN_EDGE_THRESHOLD',
    ],
    'volatility-breakout': [
        'VOLATILITY_BREAKOUT_MIN_EDGE_THRESHOLD',
        'VOL_BREAKOUT_MIN_EDGE_THRESHOLD',
    ],
};

function parseNonNegativeNumber(raw: string | undefined): number | null {
    if (raw === undefined) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
}

export function getMinEdgeThresholdForStrategy(
    strategyName: string,
    globalFallback: number
): number {
    const keys = STRATEGY_ENV_KEYS[strategyName] ?? [];
    for (const key of keys) {
        const parsed = parseNonNegativeNumber(process.env[key]);
        if (parsed !== null) return parsed;
    }
    return globalFallback;
}
