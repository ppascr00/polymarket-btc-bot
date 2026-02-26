'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

const STRATEGY_LABELS: Record<string, string> = {
    probabilistic: 'Probabilistic',
    'ema-crossover': 'EMA Crossover',
    'rsi-reversion': 'RSI Reversion',
    'volatility-breakout': 'Volatility Breakout',
    'ai-adaptive': 'AI Adaptive',
};

type StrategyWindow = 'today' | '24h' | '7d' | '30d' | 'all';

const STRATEGY_WINDOW_OPTIONS: Array<{ key: StrategyWindow; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
    { key: 'all', label: 'All' },
];

interface StatusData {
    mode: string;
    availableModes?: string[];
    accountBalance?: number | null;
    accountBalanceSource?: string;
    accountBalanceError?: string | null;
    running: boolean;
    processRunning: boolean;
    paused: boolean;
    paperMultiEnabled?: boolean;
    strategy: string;
    availableStrategies: string[];
    consecutiveErrors: number;
    lastSignal: {
        direction: string;
        confidence: number;
        pUp: number;
        edge: number;
        reasons: string[];
        strategyName: string;
        timestamp: number;
    } | null;
    health: {
        exchangeConnected: boolean;
        exchangeLatencyMs: number;
        dbOk: boolean;
        uptimeSeconds: number;
    };
}

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

interface StatsData {
    totalTrades: number;
    todayTrades: number;
    todayPnL: number;
    totalPnL: number;
    winRate: number;
    consecutiveLosses: number;
    recentPnLs: number[];
}

interface StrategyStatsRow {
    strategy: string;
    totalTrades: number;
    closedTrades: number;
    pendingTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    pnl: number;
    avgEdge: number;
    avgConfidence: number;
    avgStake: number;
}

interface StrategyRecommendation {
    strategy: string | null;
    confidence: 'low' | 'medium' | 'high';
    reason: string;
    minClosedTrades: number;
    basedOnWindow: StrategyWindow;
    sampleClosedTrades: number;
    metrics: {
        pnl: number;
        winRate: number;
        pnlPerTrade: number;
        avgEdge: number;
        avgConfidence: number;
    } | null;
}

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

interface BtcPriceData {
    symbol: string;
    price: number | null;
    timestamp: number;
    source: string;
}

export default function DashboardPage() {
    const [status, setStatus] = useState<StatusData | null>(null);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [stats, setStats] = useState<StatsData | null>(null);
    const [strategyStats, setStrategyStats] = useState<StrategyStatsRow[]>([]);
    const [strategyWindows, setStrategyWindows] = useState<StrategyWindowRow[]>([]);
    const [strategyWindow, setStrategyWindow] = useState<StrategyWindow>('7d');
    const [strategyRecommendation, setStrategyRecommendation] = useState<StrategyRecommendation | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isTogglingBot, setIsTogglingBot] = useState(false);
    const [isTogglingProcess, setIsTogglingProcess] = useState(false);
    const [isUpdatingStrategy, setIsUpdatingStrategy] = useState(false);
    const [isUpdatingMode, setIsUpdatingMode] = useState(false);
    const [isUpdatingPaperMulti, setIsUpdatingPaperMulti] = useState(false);
    const [btcPrice, setBtcPrice] = useState<BtcPriceData | null>(null);
    const [btcDelta, setBtcDelta] = useState<number>(0);
    const [btcDirection, setBtcDirection] = useState<'up' | 'down' | 'flat'>('flat');
    const lastBtcPriceRef = useRef<number | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, tradesRes, strategyStatsRes, strategyWindowsRes] = await Promise.all([
                fetch('/api/status', { cache: 'no-store' }),
                fetch('/api/trades', { cache: 'no-store' }),
                fetch(`/api/strategy-stats?window=${strategyWindow}&minClosed=20`, { cache: 'no-store' }),
                fetch('/api/strategy-windows?limit=24&offset=0', { cache: 'no-store' }),
            ]);

            if (statusRes.ok) {
                const data = await statusRes.json();
                setStatus(data.status);
                setStats(data.stats);
            }

            if (tradesRes.ok) {
                const data = await tradesRes.json();
                setTrades(data.trades ?? []);
            }

            if (strategyStatsRes.ok) {
                const data = await strategyStatsRes.json();
                setStrategyStats(data.rows ?? []);
                setStrategyRecommendation(data.recommendation ?? null);
            } else {
                setStrategyStats([]);
                setStrategyRecommendation(null);
            }

            if (strategyWindowsRes.ok) {
                const data = await strategyWindowsRes.json();
                setStrategyWindows(data.rows ?? []);
            } else {
                setStrategyWindows([]);
            }

            setLastUpdate(new Date().toLocaleTimeString());
            setError('');
        } catch (err) {
            setError('Failed to fetch data. Is the bot running?');
        }
    }, [strategyWindow]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10_000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const fetchBtcPrice = useCallback(async () => {
        try {
            const res = await fetch('/api/btc-price', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json() as BtcPriceData;
            if (typeof data.price === 'number' && Number.isFinite(data.price)) {
                const prev = lastBtcPriceRef.current;
                if (prev !== null) {
                    const diff = data.price - prev;
                    if (diff > 0) {
                        setBtcDelta(diff);
                        setBtcDirection('up');
                    } else if (diff < 0) {
                        setBtcDelta(diff);
                        setBtcDirection('down');
                    }
                } else {
                    setBtcDelta(0);
                    setBtcDirection('flat');
                }
                lastBtcPriceRef.current = data.price;
            }
            setBtcPrice(data);
        } catch {
            // Keep last known value.
        }
    }, []);

    useEffect(() => {
        fetchBtcPrice();
        const interval = setInterval(fetchBtcPrice, 1_000);
        return () => clearInterval(interval);
    }, [fetchBtcPrice]);

    const formatBtcDelta = useCallback((value: number): string => {
        const abs = Math.abs(value);
        const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
        return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
    }, []);

    const toggleBot = useCallback(async () => {
        if (!status || isTogglingBot || !status.processRunning) return;

        setIsTogglingBot(true);
        try {
            const nextPaused = !status.paused;
            const res = await fetch('/api/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paused: nextPaused }),
            });
            const payload = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(payload?.error || 'Control request failed');
            }

            await fetchData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle bot state');
        } finally {
            setIsTogglingBot(false);
        }
    }, [status, isTogglingBot, fetchData]);

    const toggleBotProcess = useCallback(async () => {
        if (!status || isTogglingProcess) return;

        setIsTogglingProcess(true);
        try {
            const action = status.processRunning ? 'stop' : 'start';
            const res = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const payload = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(payload?.message || payload?.error || 'Process control request failed');
            }

            await fetchData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start/stop bot process');
        } finally {
            setIsTogglingProcess(false);
        }
    }, [status, isTogglingProcess, fetchData]);

    const updateStrategy = useCallback(async (strategy: string) => {
        if (!status || isUpdatingStrategy) return;
        if (strategy === status.strategy) return;

        setIsUpdatingStrategy(true);
        try {
            const res = await fetch('/api/strategy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategy }),
            });

            if (!res.ok) {
                throw new Error('Strategy update failed');
            }

            await fetchData();
        } catch {
            setError('Failed to change strategy');
        } finally {
            setIsUpdatingStrategy(false);
        }
    }, [status, isUpdatingStrategy, fetchData]);

    const updateMode = useCallback(async (mode: 'PAPER' | 'LIVE') => {
        if (!status || isUpdatingMode) return;
        if (status.mode === mode) return;

        setIsUpdatingMode(true);
        try {
            const res = await fetch('/api/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
            });
            if (!res.ok) {
                throw new Error('Mode update failed');
            }
            await fetchData();
        } catch {
            setError('Failed to change mode');
        } finally {
            setIsUpdatingMode(false);
        }
    }, [status, isUpdatingMode, fetchData]);

    const updatePaperMulti = useCallback(async (enabled: boolean) => {
        if (!status || isUpdatingPaperMulti) return;
        if (status.mode !== 'PAPER') return;
        if ((status.paperMultiEnabled ?? false) === enabled) return;

        setIsUpdatingPaperMulti(true);
        try {
            const res = await fetch('/api/paper-multi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (!res.ok) {
                throw new Error('Paper multi update failed');
            }
            await fetchData();
        } catch {
            setError('Failed to update PAPER multi mode');
        } finally {
            setIsUpdatingPaperMulti(false);
        }
    }, [status, isUpdatingPaperMulti, fetchData]);

    const mode = status?.mode ?? 'PAPER';
    const signal = status?.lastSignal;
    const comparisonStrategies = status?.availableStrategies ?? Object.keys(STRATEGY_LABELS);
    const paperMultiLabel = `PAPER x${comparisonStrategies.length}`;

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">₿ Polymarket BTC Bot</h1>
                    <p className="dashboard-subtitle">5-Minute Up/Down Trading Dashboard</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="strategy-picker">
                        <span className="strategy-picker-label">
                            {status?.paperMultiEnabled ? 'Focus Signal' : 'Strategy'}
                        </span>
                        <select
                            className="strategy-select"
                            value={status?.strategy ?? 'probabilistic'}
                            disabled={!status || isUpdatingStrategy}
                            onChange={(e) => updateStrategy(e.target.value)}
                        >
                            {(status?.availableStrategies ?? ['probabilistic']).map((name) => (
                                <option key={name} value={name}>
                                    {STRATEGY_LABELS[name] ?? name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mode-toggle">
                        <button
                            className={`mode-chip ${status?.paperMultiEnabled ? 'active' : ''}`}
                            disabled={!status || mode !== 'PAPER' || isUpdatingPaperMulti}
                            onClick={() => updatePaperMulti(!(status?.paperMultiEnabled ?? false))}
                        >
                                {isUpdatingPaperMulti
                                    ? 'Updating...'
                                    : status?.paperMultiEnabled
                                        ? `${paperMultiLabel} ON`
                                        : `${paperMultiLabel} OFF`}
                        </button>
                    </div>
                    <div className="mode-toggle">
                        <button
                            className={`mode-chip ${mode === 'PAPER' ? 'active' : ''}`}
                            disabled={isUpdatingMode}
                            onClick={() => updateMode('PAPER')}
                        >
                            PAPER
                        </button>
                        <button
                            className={`mode-chip ${mode === 'LIVE' ? 'active' : ''}`}
                            disabled={isUpdatingMode}
                            onClick={() => updateMode('LIVE')}
                        >
                            LIVE
                        </button>
                    </div>
                    <button
                        className={`control-btn ${status?.processRunning ? 'on' : 'off'}`}
                        onClick={toggleBotProcess}
                        disabled={!status || isTogglingProcess}
                    >
                        {isTogglingProcess
                            ? 'Updating...'
                            : status?.processRunning
                                ? 'Stop Bot'
                                : 'Start Bot'}
                    </button>
                    <button
                        className={`control-btn ${status?.paused ? 'off' : 'on'}`}
                        onClick={toggleBot}
                        disabled={!status || isTogglingBot || !status.processRunning}
                    >
                        {isTogglingBot
                            ? 'Updating...'
                            : status?.paused
                                ? 'Activate Bot'
                                : 'Pause Bot'}
                    </button>
                    <span className={`mode-badge ${mode.toLowerCase()}`}>
                        {mode === 'LIVE' ? '🔴' : '🔵'} {mode}
                    </span>
                    {status?.paused && (
                        <span className="mode-badge" style={{ background: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)', border: '1px solid rgba(245,158,11,0.3)' }}>
                            ⏸ PAUSED
                        </span>
                    )}
                    {!status?.processRunning && (
                        <span className="mode-badge" style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid rgba(239,68,68,0.3)' }}>
                            BOT OFF
                        </span>
                    )}
                </div>
            </header>

            {error && (
                <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent-yellow)', background: 'var(--accent-yellow-dim)' }}>
                    <p style={{ color: 'var(--accent-yellow)', fontSize: 13 }}>⚠️ {error}</p>
                </div>
            )}

            {/* Refresh Bar */}
            <div className="refresh-bar">
                <div className={`btc-ticker btc-${btcDirection}`}>
                    <div className="btc-ticker-label">{btcPrice?.symbol || 'BTC/USD'}</div>
                    <div className="btc-ticker-price">
                        {btcPrice?.price != null ? `$${btcPrice.price.toFixed(2)}` : '--'}
                    </div>
                    <div className="btc-ticker-meta">
                        <span className={`btc-ticker-arrow arrow-${btcDirection}`}>
                            {btcDirection === 'up' ? '▲' : btcDirection === 'down' ? '▼' : '•'}
                        </span>
                        <span>{formatBtcDelta(btcDelta)}</span>
                        <span>{btcPrice?.source ? ` · ${btcPrice.source}` : ''}</span>
                    </div>
                </div>
                <span className="last-update">Last update: {lastUpdate || '—'}</span>
                <button className="refresh-btn" onClick={fetchData}>⟳ Refresh</button>
            </div>

            {/* Stats Cards */}
            <div className="grid-top">
                <div className="card">
                    <div className="card-title">Today P&L</div>
                    <div className={`card-value ${(stats?.todayPnL ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                        ${(stats?.todayPnL ?? 0).toFixed(2)}
                    </div>
                    <div className="card-detail">{stats?.todayTrades ?? 0} trades today</div>
                </div>

                <div className="card">
                    <div className="card-title">Total P&L</div>
                    <div className={`card-value ${(stats?.totalPnL ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                        ${(stats?.totalPnL ?? 0).toFixed(2)}
                    </div>
                    <div className="card-detail">{stats?.totalTrades ?? 0} total trades</div>
                </div>

                <div className="card">
                    <div className="card-title">Win Rate</div>
                    <div className={`card-value ${(stats?.winRate ?? 0) >= 0.5 ? 'positive' : 'negative'}`}>
                        {((stats?.winRate ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div className="card-detail">
                        Losses streak: {stats?.consecutiveLosses ?? 0}
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">Balance</div>
                    <div className="card-value neutral" style={{ fontSize: 24 }}>
                        {status?.accountBalance !== null && status?.accountBalance !== undefined
                            ? `$${status.accountBalance.toFixed(2)}`
                            : '—'}
                    </div>
                    <div className="card-detail">
                        {status?.accountBalanceSource === 'paper-simulated'
                            ? 'Simulated in PAPER mode'
                            : status?.accountBalanceSource === 'paper-simulated-multi'
                                ? `Aggregated across ${paperMultiLabel} strategy wallets`
                                : status?.accountBalanceSource === 'live-polymarket'
                                    ? 'Real balance from Polymarket'
                                    : 'Live balance unavailable'}
                    </div>
                    {status?.accountBalanceError && (
                        <div className="card-detail" style={{ color: 'var(--accent-yellow)', marginTop: 4 }}>
                            {status.accountBalanceError}
                        </div>
                    )}
                </div>

                <div className="card">
                    <div className="card-title">Strategy</div>
                    <div className="card-value neutral" style={{ fontSize: 20 }}>
                        {status?.paperMultiEnabled ? `paper-multi (${paperMultiLabel})` : (status?.strategy ?? '-')}
                    </div>
                    <div className="card-detail">
                        {status?.paperMultiEnabled
                            ? `Focus signal: ${status?.strategy ?? '-'}`
                            : `Errors: ${status?.consecutiveErrors ?? 0}`}
                    </div>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid-main">
                {/* Left: Trades + Equity */}
                <div>
                    {/* Equity Chart */}
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-title">Equity Curve (Recent Trades)</div>
                        <div className="equity-chart">
                            {(stats?.recentPnLs ?? []).map((pnl, i) => {
                                const maxAbs = Math.max(...(stats?.recentPnLs ?? [1]).map(Math.abs), 0.01);
                                const h = Math.min(100, Math.abs(pnl) / maxAbs * 100);
                                return (
                                    <div
                                        key={i}
                                        className={`equity-bar ${pnl >= 0 ? 'positive' : 'negative'}`}
                                        style={{ height: `${Math.max(4, h)}%` }}
                                        title={`$${pnl.toFixed(2)}`}
                                    />
                                );
                            })}
                            {(!stats?.recentPnLs || stats.recentPnLs.length === 0) && (
                                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 'auto' }}>
                                    No trades yet
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Trade Table */}
                    <div className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div className="card-title" style={{ marginBottom: 0 }}>Recent Trades</div>
                            <Link className="view-all-link" href="/trades">View all</Link>
                        </div>
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
                                                No trades recorded yet
                                            </td>
                                        </tr>
                                    ) : (
                                        trades.slice(0, 20).map((trade) => (
                                            <tr key={trade.id}>
                                                <td>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                                                <td>
                                                    <span className={`badge dir-badge ${trade.direction.toLowerCase()}`}>
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
                    </div>
                </div>

                {/* Right: Signal + Health */}
                <div>
                    {/* Last Signal */}
                    <div className="card signal-card" style={{ marginBottom: 24 }}>
                        <div className="card-title">Last Signal</div>
                        {signal ? (
                            <>
                                <div className={`signal-direction ${signal.direction.toLowerCase().replace('_', '-')}`}>
                                    {signal.direction === 'UP' ? '▲' : signal.direction === 'DOWN' ? '▼' : '⊘'}
                                    {signal.direction}
                                </div>
                                <div className="signal-meta">
                                    <div className="signal-meta-item">
                                        <div className="signal-meta-label">P(UP)</div>
                                        <div className="signal-meta-value">{(signal.pUp * 100).toFixed(1)}%</div>
                                    </div>
                                    <div className="signal-meta-item">
                                        <div className="signal-meta-label">Confidence</div>
                                        <div className="signal-meta-value">{(signal.confidence * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="signal-meta-item">
                                        <div className="signal-meta-label">Edge</div>
                                        <div className="signal-meta-value">{(signal.edge * 100).toFixed(1)}%</div>
                                    </div>
                                </div>
                                <ul className="signal-reasons">
                                    {signal.reasons.slice(0, 5).map((r, i) => (
                                        <li key={i}>{r}</li>
                                    ))}
                                </ul>
                                <div className="card-detail" style={{ marginTop: 8 }}>
                                    {new Date(signal.timestamp).toLocaleString()} — {signal.strategyName}
                                </div>
                            </>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                Waiting for first signal...
                            </p>
                        )}
                    </div>

                    {/* System Health */}
                    <div className="card">
                        <div className="card-title" style={{ marginBottom: 12 }}>System Health</div>
                        <div className="health-grid">
                            <div className="health-item">
                                <div className={`health-dot ${status?.health?.exchangeConnected ? 'ok' : 'error'}`} />
                                <span className="health-label">Exchange WS</span>
                                <span className="health-value">
                                    {status?.health?.exchangeConnected ? 'Connected' : 'Disconnected'}
                                </span>
                            </div>
                            <div className="health-item">
                                <div className={`health-dot ${(status?.health?.exchangeLatencyMs ?? Infinity) < 5000 ? 'ok' : 'warn'}`} />
                                <span className="health-label">Latency</span>
                                <span className="health-value">
                                    {status?.health?.exchangeLatencyMs !== undefined
                                        ? `${(status.health.exchangeLatencyMs / 1000).toFixed(1)}s`
                                        : '—'}
                                </span>
                            </div>
                            <div className="health-item">
                                <div className={`health-dot ${status?.health?.dbOk ? 'ok' : 'error'}`} />
                                <span className="health-label">Database</span>
                                <span className="health-value">
                                    {status?.health?.dbOk ? 'OK' : 'Error'}
                                </span>
                            </div>
                            <div className="health-item">
                                <div className={`health-dot ${status?.running ? 'ok' : 'warn'}`} />
                                <span className="health-label">Scheduler</span>
                                <span className="health-value">
                                    {status?.paused ? 'Paused' : status?.running ? 'Running' : 'Stopped'}
                                </span>
                            </div>
                            <div className="health-item" style={{ gridColumn: 'span 2' }}>
                                <div className="health-dot ok" />
                                <span className="health-label">Uptime</span>
                                <span className="health-value">
                                    {status?.health?.uptimeSeconds !== undefined
                                        ? `${Math.floor((status.health.uptimeSeconds) / 60)}m ${Math.floor(status.health.uptimeSeconds % 60)}s`
                                        : '—'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
                <div className="strategy-compare-header">
                    <div className="card-title" style={{ marginBottom: 0 }}>
                        Strategy Comparison
                    </div>
                    <div className="window-toggle">
                        {STRATEGY_WINDOW_OPTIONS.map((opt) => (
                            <button
                                key={opt.key}
                                className={`window-chip ${strategyWindow === opt.key ? 'active' : ''}`}
                                onClick={() => setStrategyWindow(opt.key)}
                                type="button"
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="card-detail" style={{ marginBottom: 12 }}>
                    Mode: {mode} · Window: {STRATEGY_WINDOW_OPTIONS.find((w) => w.key === strategyWindow)?.label}
                </div>
                {strategyRecommendation && (
                    <div className={`recommendation-box rec-${strategyRecommendation.confidence}`}>
                        <div className="recommendation-top">
                            <span className="card-title" style={{ marginBottom: 0 }}>Suggested Strategy</span>
                            <span className="recommendation-name">
                                {strategyRecommendation.strategy
                                    ? (STRATEGY_LABELS[strategyRecommendation.strategy] ?? strategyRecommendation.strategy)
                                    : 'Not enough data'}
                            </span>
                            {strategyRecommendation.strategy && (
                                <button
                                    className="refresh-btn"
                                    type="button"
                                    disabled={isUpdatingStrategy || status?.strategy === strategyRecommendation.strategy}
                                    onClick={() => updateStrategy(strategyRecommendation.strategy!)}
                                >
                                    {status?.strategy === strategyRecommendation.strategy ? 'Active' : 'Use suggested'}
                                </button>
                            )}
                        </div>
                        <div className="card-detail">{strategyRecommendation.reason}</div>
                        {strategyRecommendation.metrics && (
                            <div className="card-detail">
                                Win rate: {(strategyRecommendation.metrics.winRate * 100).toFixed(1)}%
                                {' · '}
                                P&L: {strategyRecommendation.metrics.pnl >= 0 ? '+' : ''}{strategyRecommendation.metrics.pnl.toFixed(2)}
                                {' · '}
                                P&L/trade: {strategyRecommendation.metrics.pnlPerTrade >= 0 ? '+' : ''}{strategyRecommendation.metrics.pnlPerTrade.toFixed(3)}
                                {' · '}
                                Avg edge: {(strategyRecommendation.metrics.avgEdge * 100).toFixed(1)}%
                            </div>
                        )}
                    </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                    <table className="strategy-table">
                        <thead>
                            <tr>
                                <th>Strategy</th>
                                <th>Trades</th>
                                <th>Closed</th>
                                <th>Pending</th>
                                <th>Win Rate</th>
                                <th>P&L</th>
                                <th>Avg Edge</th>
                                <th>Avg Conf</th>
                                <th>Avg Stake</th>
                            </tr>
                        </thead>
                        <tbody>
                            {strategyStats.length === 0 ? (
                                <tr>
                                    <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
                                        No strategy data available
                                    </td>
                                </tr>
                            ) : (
                                strategyStats.map((row) => (
                                    <tr key={row.strategy} className={status?.strategy === row.strategy ? 'strategy-row-active' : ''}>
                                        <td>{STRATEGY_LABELS[row.strategy] ?? row.strategy}</td>
                                        <td>{row.totalTrades}</td>
                                        <td>{row.closedTrades}</td>
                                        <td>{row.pendingTrades}</td>
                                        <td>{(row.winRate * 100).toFixed(1)}%</td>
                                        <td style={{ color: row.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                            {row.pnl >= 0 ? '+' : ''}{row.pnl.toFixed(2)}
                                        </td>
                                        <td>{(row.avgEdge * 100).toFixed(1)}%</td>
                                        <td>{(row.avgConfidence * 100).toFixed(0)}%</td>
                                        <td>${row.avgStake.toFixed(2)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
                <div className="strategy-compare-header">
                    <div className="card-title" style={{ marginBottom: 0 }}>
                        Window Matrix ({paperMultiLabel})
                    </div>
                    <Link className="view-all-link" href="/strategy-windows">
                        View full table
                    </Link>
                </div>
                <div className="card-detail" style={{ marginBottom: 12 }}>
                    Each row is one 5-minute window. This lets you compare if one strategy traded while another skipped.
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="window-matrix-table">
                        <thead>
                            <tr>
                                <th>Window</th>
                                <th>BTC Entry</th>
                                <th>BTC Close</th>
                                <th>Total Stake</th>
                                {comparisonStrategies.map((strategyName) => (
                                    <th key={strategyName}>{STRATEGY_LABELS[strategyName] ?? strategyName}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {strategyWindows.length === 0 ? (
                                <tr>
                                    <td colSpan={comparisonStrategies.length + 4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
                                        No multi-strategy window data yet
                                    </td>
                                </tr>
                            ) : (
                                strategyWindows.map((row) => (
                                    <tr key={row.windowStart}>
                                        <td>{new Date(row.windowStart).toLocaleTimeString()}</td>
                                        <td>{row.btcPriceEntry != null ? `$${row.btcPriceEntry.toFixed(2)}` : '--'}</td>
                                        <td>{row.btcPriceClose != null ? `$${row.btcPriceClose.toFixed(2)}` : '--'}</td>
                                        <td>${row.totalStake.toFixed(2)}</td>
                                        {comparisonStrategies.map((strategyName) => {
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
                                                    ? '▲UP'
                                                    : cell.direction === 'DOWN'
                                                        ? '▼DOWN'
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
            </div>

            {/* Disclaimer */}
            <footer style={{ textAlign: 'center', padding: '24px 0', borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    ⚠️ This bot does NOT guarantee profits. Trading prediction markets carries risk of total loss.
                    Use at your own risk.
                </p>
            </footer>
        </div>
    );
}

