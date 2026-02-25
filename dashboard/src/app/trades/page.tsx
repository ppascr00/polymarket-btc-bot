'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Trade {
    id: number;
    timestamp: number;
    direction: string;
    confidence: number;
    edge: number;
    entryPrice: number;
    stake: number;
    pnl: number;
    outcome: string;
    strategy: string;
    btcPriceEntry?: number;
    btcPriceClose?: number;
}

const PAGE_SIZE = 100;

export default function AllTradesPage() {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchTrades = useCallback(async (nextOffset: number) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/trades?limit=${PAGE_SIZE}&offset=${nextOffset}`);
            if (!res.ok) throw new Error('Failed to fetch trades');

            const data = await res.json() as { trades: Trade[]; total: number; offset: number };
            setTrades(data.trades ?? []);
            setTotal(data.total ?? 0);
            setOffset(data.offset ?? nextOffset);
            setError('');
        } catch {
            setError('Failed to load trades');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTrades(0);
    }, [fetchTrades]);

    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">All Trades</h1>
                    <p className="dashboard-subtitle">Complete trade history ({total} records)</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                    <table className="trade-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Dir</th>
                                <th>Strategy</th>
                                <th>Conf</th>
                                <th>Edge</th>
                                <th>Stake</th>
                                <th>BTC Entry</th>
                                <th>BTC Close</th>
                                <th>P&L</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.length === 0 ? (
                                <tr>
                                    <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                                        {loading ? 'Loading...' : 'No trades found'}
                                    </td>
                                </tr>
                            ) : (
                                trades.map((trade) => (
                                    <tr key={trade.id}>
                                        <td>{new Date(trade.timestamp).toLocaleString()}</td>
                                        <td>
                                            <span className={`badge ${trade.direction.toLowerCase()}`}>
                                                {trade.direction === 'UP' ? '▲' : '▼'} {trade.direction}
                                            </span>
                                        </td>
                                        <td>{trade.strategy ?? '—'}</td>
                                        <td>{(trade.confidence * 100).toFixed(0)}%</td>
                                        <td>{(trade.edge * 100).toFixed(1)}%</td>
                                        <td>${trade.stake.toFixed(2)}</td>
                                        <td>{trade.btcPriceEntry ? `$${trade.btcPriceEntry.toFixed(2)}` : '—'}</td>
                                        <td>{trade.btcPriceClose ? `$${trade.btcPriceClose.toFixed(2)}` : '—'}</td>
                                        <td style={{ color: trade.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                                        </td>
                                        <td>
                                            <span className={`badge ${trade.outcome.toLowerCase()}`}>
                                                {trade.outcome}
                                            </span>
                                        </td>
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
                            onClick={() => fetchTrades(Math.max(0, offset - PAGE_SIZE))}
                        >
                            Prev
                        </button>
                        <button
                            className="refresh-btn"
                            disabled={loading || offset + PAGE_SIZE >= total}
                            onClick={() => fetchTrades(offset + PAGE_SIZE)}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
