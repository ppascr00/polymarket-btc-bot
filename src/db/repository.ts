// ============================================
// Polymarket BTC Bot — Database Repository
// ============================================

import type Database from 'better-sqlite3';
import type {
    Candle,
    FeatureSet,
    TradeRecord,
    TradeOutcome,
    StrategyWindowSignalRecord,
} from '../types/index.js';

export class Repository {
    constructor(private db: Database.Database) { }

    // ─── Candles ────────────────────────────────────

    insertCandle(candle: Candle): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO candles_1m (timestamp, open, high, low, close, volume, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                candle.timestamp,
                candle.open,
                candle.high,
                candle.low,
                candle.close,
                candle.volume,
                candle.source
            );
    }

    insertCandles(candles: Candle[]): void {
        const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO candles_1m (timestamp, open, high, low, close, volume, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const tx = this.db.transaction((items: Candle[]) => {
            for (const c of items) {
                stmt.run(c.timestamp, c.open, c.high, c.low, c.close, c.volume, c.source);
            }
        });
        tx(candles);
    }

    getCandles(start: number, end: number): Candle[] {
        return this.db
            .prepare(
                `SELECT timestamp, open, high, low, close, volume, source
         FROM candles_1m
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`
            )
            .all(start, end) as Candle[];
    }

    getLatestCandleTimestamp(): number | null {
        const row = this.db
            .prepare('SELECT MAX(timestamp) as ts FROM candles_1m')
            .get() as { ts: number | null };
        return row?.ts ?? null;
    }

    // ─── Features ────────────────────────────────────

    insertFeatures(features: FeatureSet): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO features_5m
         (window_start, window_end, open, close, ret_1m, ret_5m, ema3, ema8,
          rsi14, volatility, range_hl, volume, ob_imbalance, spread, mid_change, direction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                features.windowStart,
                features.windowEnd,
                features.open,
                features.close,
                features.ret1m,
                features.ret5m,
                features.ema3,
                features.ema8,
                features.rsi14,
                features.volatility,
                features.rangeHL,
                features.volume,
                features.obImbalance,
                features.spread,
                features.midChange,
                null // direction computed after window closes
            );
    }

    getFeatures(start: number, end: number): FeatureSet[] {
        return this.db
            .prepare(
                `SELECT window_start as windowStart, window_end as windowEnd,
                open, close, ret_1m as ret1m, ret_5m as ret5m, ema3, ema8,
                rsi14, volatility, range_hl as rangeHL, volume,
                ob_imbalance as obImbalance, spread, mid_change as midChange
         FROM features_5m
         WHERE window_start >= ? AND window_start < ?
         ORDER BY window_start ASC`
            )
            .all(start, end) as FeatureSet[];
    }

    getAllFeatures(): FeatureSet[] {
        return this.db
            .prepare(
                `SELECT window_start as windowStart, window_end as windowEnd,
                open, close, ret_1m as ret1m, ret_5m as ret5m, ema3, ema8,
                rsi14, volatility, range_hl as rangeHL, volume,
                ob_imbalance as obImbalance, spread, mid_change as midChange
         FROM features_5m
         ORDER BY window_start ASC`
            )
            .all() as FeatureSet[];
    }

    updateFeatureDirection(windowStart: number, direction: 'UP' | 'DOWN'): void {
        this.db
            .prepare('UPDATE features_5m SET direction = ? WHERE window_start = ?')
            .run(direction, windowStart);
    }

    // ─── Trades ────────────────────────────────────

    insertTrade(trade: TradeRecord): number {
        const result = this.db
            .prepare(
                `INSERT INTO trades
         (timestamp, window_start, mode, strategy, direction, confidence, edge,
          entry_price, market_yes_price, market_no_price, stake, pnl, outcome, reasons,
          btc_price_entry, btc_price_close)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                trade.timestamp,
                trade.windowStart,
                trade.mode,
                trade.strategy,
                trade.direction,
                trade.confidence,
                trade.edge,
                trade.entryPrice,
                trade.marketYesPrice,
                trade.marketNoPrice,
                trade.stake,
                trade.pnl,
                trade.outcome,
                JSON.stringify(trade.reasons),
                trade.btcPriceEntry ?? null,
                trade.btcPriceClose ?? null
            );
        return result.lastInsertRowid as number;
    }

    updateTradeOutcome(id: number, outcome: TradeOutcome, pnl: number, btcPriceClose?: number): void {
        if (btcPriceClose !== undefined) {
            this.db
                .prepare('UPDATE trades SET outcome = ?, pnl = ?, btc_price_close = ? WHERE id = ?')
                .run(outcome, pnl, btcPriceClose, id);
        } else {
            this.db
                .prepare('UPDATE trades SET outcome = ?, pnl = ? WHERE id = ?')
                .run(outcome, pnl, id);
        }
    }

    getRecentTrades(limit: number = 50): TradeRecord[] {
        const rows = this.db
            .prepare(
                `SELECT id, timestamp, window_start as windowStart, mode, strategy,
                direction, confidence, edge, entry_price as entryPrice,
                market_yes_price as marketYesPrice, market_no_price as marketNoPrice,
                stake, pnl, outcome, reasons,
                btc_price_entry as btcPriceEntry, btc_price_close as btcPriceClose
         FROM trades ORDER BY timestamp DESC LIMIT ?`
            )
            .all(limit) as Array<TradeRecord & { reasons: string }>;

        return rows.map((r) => ({
            ...r,
            reasons: typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons,
        }));
    }

    getTradesForDay(dayStart: number): TradeRecord[] {
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        const rows = this.db
            .prepare(
                `SELECT id, timestamp, window_start as windowStart, mode, strategy,
                direction, confidence, edge, entry_price as entryPrice,
                market_yes_price as marketYesPrice, market_no_price as marketNoPrice,
                stake, pnl, outcome, reasons,
                btc_price_entry as btcPriceEntry, btc_price_close as btcPriceClose
         FROM trades WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`
            )
            .all(dayStart, dayEnd) as Array<TradeRecord & { reasons: string }>;

        return rows.map((r) => ({
            ...r,
            reasons: typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons,
        }));
    }

    getDailyPnL(dayStart: number): number {
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        const row = this.db
            .prepare(
                'SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE timestamp >= ? AND timestamp < ?'
            )
            .get(dayStart, dayEnd) as { total: number };
        return row.total;
    }

    getConsecutiveLosses(): number {
        const rows = this.db
            .prepare(
                `SELECT outcome FROM trades
         WHERE outcome != 'PENDING'
         ORDER BY timestamp DESC LIMIT 20`
            )
            .all() as Array<{ outcome: string }>;

        let count = 0;
        for (const r of rows) {
            if (r.outcome === 'LOSS') count++;
            else break;
        }
        return count;
    }

    getPendingTrades(): TradeRecord[] {
        const rows = this.db
            .prepare(
                `SELECT id, timestamp, window_start as windowStart, mode, strategy,
                direction, confidence, edge, entry_price as entryPrice,
                market_yes_price as marketYesPrice, market_no_price as marketNoPrice,
                stake, pnl, outcome, reasons,
                btc_price_entry as btcPriceEntry, btc_price_close as btcPriceClose
         FROM trades WHERE outcome = 'PENDING'
         ORDER BY timestamp ASC`
            )
            .all() as Array<TradeRecord & { reasons: string }>;

        return rows.map((r) => ({
            ...r,
            reasons: typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons,
        }));
    }

    hasTradeForWindow(windowStart: number): boolean {
        const row = this.db
            .prepare('SELECT COUNT(*) as cnt FROM trades WHERE window_start = ?')
            .get(windowStart) as { cnt: number };
        return row.cnt > 0;
    }

    hasTradeForWindowByStrategy(windowStart: number, strategy: string): boolean {
        const row = this.db
            .prepare('SELECT COUNT(*) as cnt FROM trades WHERE window_start = ? AND strategy = ?')
            .get(windowStart, strategy) as { cnt: number };
        return row.cnt > 0;
    }

    getClosedPnlByModeAndStrategy(mode: 'PAPER' | 'LIVE', strategy: string): number {
        const row = this.db
            .prepare(
                `SELECT COALESCE(SUM(pnl), 0) as total
         FROM trades
         WHERE mode = ? AND strategy = ? AND outcome != 'PENDING'`
            )
            .get(mode, strategy) as { total: number };
        return row.total;
    }

    // â”€â”€â”€ Strategy Signals by Window â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    insertStrategyWindowSignal(signal: StrategyWindowSignalRecord): void {
        this.db
            .prepare(
                `INSERT INTO paper_strategy_signals
         (timestamp, window_start, mode, strategy, direction, confidence, p_up, edge,
          should_trade, decision_reason, reasons, trade_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(window_start, mode, strategy)
         DO UPDATE SET
            timestamp = excluded.timestamp,
            direction = excluded.direction,
            confidence = excluded.confidence,
            p_up = excluded.p_up,
            edge = excluded.edge,
            should_trade = excluded.should_trade,
            decision_reason = excluded.decision_reason,
            reasons = excluded.reasons,
            trade_id = excluded.trade_id`
            )
            .run(
                signal.timestamp,
                signal.windowStart,
                signal.mode,
                signal.strategy,
                signal.direction,
                signal.confidence,
                signal.pUp,
                signal.edge,
                signal.shouldTrade ? 1 : 0,
                signal.decisionReason,
                JSON.stringify(signal.reasons),
                signal.tradeId ?? null,
                Date.now()
            );
    }

    // ─── System State ────────────────────────────────

    getState(key: string): string | null {
        const row = this.db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    setState(key: string, value: string): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO system_state (key, value, updated_at)
         VALUES (?, ?, ?)`
            )
            .run(key, value, Date.now());
    }
}
