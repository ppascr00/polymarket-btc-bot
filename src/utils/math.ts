// ============================================
// Polymarket BTC Bot — Math / Statistics Utils
// ============================================

/**
 * Exponential Moving Average.
 * Returns the last EMA value given an array of values and period.
 */
export function ema(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0]!;

    const k = 2 / (period + 1);
    let result = values[0]!;

    for (let i = 1; i < values.length; i++) {
        result = values[i]! * k + result * (1 - k);
    }

    return result;
}

/**
 * Full EMA series for the given values.
 */
export function emaSeries(values: number[], period: number): number[] {
    if (values.length === 0) return [];

    const k = 2 / (period + 1);
    const result: number[] = [values[0]!];

    for (let i = 1; i < values.length; i++) {
        result.push(values[i]! * k + result[i - 1]! * (1 - k));
    }

    return result;
}

/**
 * Relative Strength Index (RSI).
 */
export function rsi(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50; // neutral default

    let gains = 0;
    let losses = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const change = closes[i]! - closes[i - 1]!;
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smoothed RSI
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i]! - closes[i - 1]!;
        if (change > 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

/**
 * Realized volatility (standard deviation of returns).
 */
export function realizedVolatility(closes: number[]): number {
    if (closes.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        returns.push(Math.log(closes[i]! / closes[i - 1]!));
    }

    return standardDeviation(returns);
}

/**
 * Standard deviation.
 */
export function standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map((v) => (v - mean) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Simple return.
 */
export function simpleReturn(from: number, to: number): number {
    if (from === 0) return 0;
    return (to - from) / from;
}

/**
 * Sigmoid function. Maps any real number to (0, 1).
 */
export function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

/**
 * Dot product of two vectors.
 */
export function dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
        sum += (a[i] ?? 0) * (b[i] ?? 0);
    }
    return sum;
}

/**
 * Normalize feature values (z-score).
 */
export function zScoreNormalize(
    values: number[]
): { normalized: number[]; mean: number; std: number } {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = standardDeviation(values);

    if (std === 0) {
        return { normalized: values.map(() => 0), mean, std };
    }

    return {
        normalized: values.map((v) => (v - mean) / std),
        mean,
        std,
    };
}

/**
 * Calculate max drawdown from a series of cumulative P&L values.
 */
export function maxDrawdown(
    equityCurve: number[]
): { maxDD: number; maxDDPct: number } {
    if (equityCurve.length === 0) return { maxDD: 0, maxDDPct: 0 };

    let peak = equityCurve[0]!;
    let maxDD = 0;
    let maxDDPct = 0;

    for (const val of equityCurve) {
        if (val > peak) peak = val;
        const dd = peak - val;
        if (dd > maxDD) {
            maxDD = dd;
            maxDDPct = peak > 0 ? dd / peak : 0;
        }
    }

    return { maxDD, maxDDPct };
}

/**
 * Sharpe ratio (annualized, assumes daily returns).
 */
export function sharpeRatio(
    returns: number[],
    riskFreeRate: number = 0
): number {
    if (returns.length === 0) return 0;
    const meanReturn =
        returns.reduce((a, b) => a + b, 0) / returns.length - riskFreeRate;
    const std = standardDeviation(returns);
    if (std === 0) return 0;
    return (meanReturn / std) * Math.sqrt(252); // annualize
}

/**
 * Profit factor = gross profits / gross losses.
 */
export function profitFactor(pnls: number[]): number {
    const profits = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const losses = Math.abs(
        pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0)
    );
    if (losses === 0) return profits > 0 ? Infinity : 0;
    return profits / losses;
}
