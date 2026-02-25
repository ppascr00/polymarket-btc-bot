// ============================================
// Polymarket BTC Bot — Backtest Metrics
// ============================================

import { maxDrawdown, sharpeRatio, profitFactor } from '../utils/math.js';
import type { BacktestMetrics, TradeRecord } from '../types/index.js';

/**
 * Compute all performance metrics from a list of completed trades.
 */
export function computeMetrics(trades: TradeRecord[]): BacktestMetrics {
    const completedTrades = trades.filter((t) => t.outcome !== 'PENDING');
    const wins = completedTrades.filter((t) => t.outcome === 'WIN');
    const losses = completedTrades.filter((t) => t.outcome === 'LOSS');
    const noTrades = trades.filter((t) => t.direction === 'NO_TRADE');

    const pnls = completedTrades.map((t) => t.pnl);
    const totalPnL = pnls.reduce((a, b) => a + b, 0);

    // Equity curve (cumulative P&L)
    const equityCurve: number[] = [];
    let cumPnL = 0;
    for (const pnl of pnls) {
        cumPnL += pnl;
        equityCurve.push(cumPnL);
    }

    const { maxDD, maxDDPct } = maxDrawdown(equityCurve.map((v, i) => 100 + v));

    // Daily returns for Sharpe
    // Group trades by day and compute daily returns
    const dailyReturns = computeDailyReturns(completedTrades);

    return {
        totalTrades: completedTrades.length,
        wins: wins.length,
        losses: losses.length,
        noTrades: noTrades.length,
        hitRate: completedTrades.length > 0 ? wins.length / completedTrades.length : 0,
        expectancy: completedTrades.length > 0 ? totalPnL / completedTrades.length : 0,
        totalPnL,
        maxDrawdown: maxDD,
        maxDrawdownPct: maxDDPct,
        sharpeRatio: sharpeRatio(dailyReturns),
        profitFactor: profitFactor(pnls),
        avgEdge:
            completedTrades.length > 0
                ? completedTrades.reduce((a, t) => a + t.edge, 0) / completedTrades.length
                : 0,
        avgConfidence:
            completedTrades.length > 0
                ? completedTrades.reduce((a, t) => a + t.confidence, 0) / completedTrades.length
                : 0,
    };
}

function computeDailyReturns(trades: TradeRecord[]): number[] {
    const byDay = new Map<string, number>();

    for (const trade of trades) {
        const day = new Date(trade.timestamp).toISOString().split('T')[0]!;
        byDay.set(day, (byDay.get(day) ?? 0) + trade.pnl);
    }

    return Array.from(byDay.values());
}

/**
 * Format metrics into a human-readable summary.
 */
export function formatMetrics(metrics: BacktestMetrics): string {
    return [
        `══════════════════════════════════════`,
        `         BACKTEST RESULTS`,
        `══════════════════════════════════════`,
        `Total Trades:     ${metrics.totalTrades}`,
        `Wins:             ${metrics.wins}`,
        `Losses:           ${metrics.losses}`,
        `No-Trade Signals: ${metrics.noTrades}`,
        `──────────────────────────────────────`,
        `Hit Rate:         ${(metrics.hitRate * 100).toFixed(1)}%`,
        `Expectancy:       $${metrics.expectancy.toFixed(4)}`,
        `Total P&L:        $${metrics.totalPnL.toFixed(2)}`,
        `──────────────────────────────────────`,
        `Max Drawdown:     $${metrics.maxDrawdown.toFixed(2)} (${(metrics.maxDrawdownPct * 100).toFixed(1)}%)`,
        `Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(3)}`,
        `Profit Factor:    ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(3)}`,
        `──────────────────────────────────────`,
        `Avg Edge:         ${(metrics.avgEdge * 100).toFixed(2)}%`,
        `Avg Confidence:   ${(metrics.avgConfidence * 100).toFixed(1)}%`,
        `══════════════════════════════════════`,
    ].join('\n');
}
