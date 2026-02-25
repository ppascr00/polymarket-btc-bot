'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface StrategyWindowAction {
    direction: string;
    confidence: number;
    edge: number;
    pUp: number;
    shouldTrade: boolean;
    decisionReason: string;
    tradeId: number | null;
    outcome: string | null;
    pnl: number | null;
    stake: number | null;
}

interface StrategyWindowRow {
    windowStart: number;
    timestamp: number;
    btcPriceEntry: number | null;
    btcPriceClose: number | null;
    totalStake: number;
    strategies: Record<string, StrategyWindowAction | null>;
}

interface ApiResponse {
    mode: 'PAPER' | 'LIVE';
    strategies: string[];
    rows: StrategyWindowRow[];
    totalWindows: number;
    limit: number;
    offset: number;
}

const STRATEGY_LABELS: Record<string, string> = {
    probabilistic: 'Probabilistic',
    'ema-crossover': 'EMA Crossover',
    'rsi-reversion': 'RSI Reversion',
    'volatility-breakout': 'Volatility Breakout',
};

const PAGE_SIZE = 100;

export default function StrategyWindowsPage() {
    const [mode, setMode] = useState<'PAPER' | 'LIVE'>('PAPER');
    const [strategies, setStrategies] = useState<string[]>([]);
    const [rows, setRows] = useState<StrategyWindowRow[]>([]);
    const [totalWindows, setTotalWindows] = useState(0);
    const [offset, setOffset] = useState(0);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchRows = useCallback(async (nextOffset: number) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/strategy-windows?limit=${PAGE_SIZE}&offset=${nextOffset}`);
            if (!res.ok) throw new Error('Failed to fetch window matrix');
            const data = await res.json() as ApiResponse;
            setMode(data.mode ?? 'PAPER');
            setStrategies(data.strategies ?? []);
            setRows(data.rows ?? []);
            setTotalWindows(data.totalWindows ?? 0);
            setOffset(data.offset ?? nextOffset);
            setError('');
        } catch {
            setError('Failed to load strategy window matrix');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRows(0);
    }, [fetchRows]);

    const currentPage = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
    const totalPages = useMemo(
        () => Math.max(1, Math.ceil(totalWindows / PAGE_SIZE)),
        [totalWindows]
    );

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">Window Matrix (PAPER x4)</h1>
                    <p className="dashboard-subtitle">
                        Full history by 5-minute window ({totalWindows} windows)
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="last-update">Mode: {mode}</span>
                    <Link className="view-all-link" href="/">Back to dashboard</Link>
                </div>
            </header>

            {error && (
                <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent-yellow)', background: 'var(--accent-yellow-dim)' }}>
                    <p style={{ color: 'var(--accent-yellow)', fontSize: 13 }}>{error}</p>
                </div>
            )}

            <div className="card">
                <div style={{ overflowX: 'auto' }}>
                    <table className="window-matrix-table">
                        <thead>
                            <tr>
                                <th>Window</th>
                                <th>BTC Entry</th>
                                <th>BTC Close</th>
                                <th>Total Stake</th>
                                {strategies.map((strategyName) => (
                                    <th key={strategyName}>
                                        {STRATEGY_LABELS[strategyName] ?? strategyName}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={strategies.length + 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                                        {loading ? 'Loading...' : 'No matrix data found'}
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.windowStart}>
                                        <td>{new Date(row.windowStart).toLocaleString()}</td>
                                        <td>{row.btcPriceEntry != null ? `$${row.btcPriceEntry.toFixed(2)}` : '--'}</td>
                                        <td>{row.btcPriceClose != null ? `$${row.btcPriceClose.toFixed(2)}` : '--'}</td>
                                        <td>${row.totalStake.toFixed(2)}</td>
                                        {strategies.map((strategyName) => {
                                            const cell = row.strategies[strategyName];
                                            if (!cell) {
                                                return (
                                                    <td key={strategyName}>
                                                        <span className="matrix-cell matrix-none">n/a</span>
                                                    </td>
                                                );
                                            }

                                            const directionLabel =
                                                cell.direction === 'UP'
                                                    ? 'UP'
                                                    : cell.direction === 'DOWN'
                                                        ? 'DOWN'
                                                        : 'NO';

                                            const stateClass = !cell.shouldTrade
                                                ? 'matrix-skip'
                                                : cell.outcome === 'WIN'
                                                    ? 'matrix-win'
                                                    : cell.outcome === 'LOSS'
                                                        ? 'matrix-loss'
                                                        : 'matrix-pending';

                                            const subText = !cell.shouldTrade
                                                ? cell.decisionReason
                                                : `${cell.outcome || 'PENDING'}${cell.stake != null ? ` | Stake $${cell.stake.toFixed(2)}` : ''}`;

                                            return (
                                                <td key={strategyName} title={cell.decisionReason}>
                                                    <span className={`matrix-cell ${stateClass}`}>
                                                        {directionLabel} {(cell.edge * 100).toFixed(1)}%
                                                    </span>
                                                    <div className="matrix-sub">{subText}</div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
                    <span className="last-update">Page {currentPage} / {totalPages}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            className="refresh-btn"
                            disabled={loading || offset === 0}
                            onClick={() => fetchRows(Math.max(0, offset - PAGE_SIZE))}
                        >
                            Prev
                        </button>
                        <button
                            className="refresh-btn"
                            disabled={loading || offset + PAGE_SIZE >= totalWindows}
                            onClick={() => fetchRows(offset + PAGE_SIZE)}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

