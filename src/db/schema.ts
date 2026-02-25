// ============================================
// Polymarket BTC Bot — SQLite Schema & Migrations
// ============================================

import Database from 'better-sqlite3';
import { getLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

const logger = getLogger();

export function initializeDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info({ dir }, 'Created database directory');
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent reads
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  migrate(db);

  logger.info({ path: dbPath }, 'Database initialized');
  return db;
}

function migrate(db: Database.Database): void {
  // Version tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const currentVersion = db
    .prepare('SELECT MAX(version) as v FROM schema_version')
    .get() as { v: number | null };

  const version = currentVersion?.v ?? 0;

  if (version < 1) {
    logger.info('Applying migration v1: core tables');
    db.exec(`
      -- Candles 1m from exchange
      CREATE TABLE IF NOT EXISTS candles_1m (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL UNIQUE,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'binance'
      );

      CREATE INDEX IF NOT EXISTS idx_candles_1m_ts ON candles_1m(timestamp);

      -- Aggregated 5m features
      CREATE TABLE IF NOT EXISTS features_5m (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        window_start INTEGER NOT NULL UNIQUE,
        window_end INTEGER NOT NULL,
        open REAL,
        close REAL,
        ret_1m REAL,
        ret_5m REAL,
        ema3 REAL,
        ema8 REAL,
        rsi14 REAL,
        volatility REAL,
        range_hl REAL,
        volume REAL,
        ob_imbalance REAL,
        spread REAL,
        mid_change REAL,
        direction TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_features_5m_ws ON features_5m(window_start);

      -- Trade records
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('PAPER', 'LIVE')),
        strategy TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('UP', 'DOWN', 'NO_TRADE')),
        confidence REAL,
        edge REAL,
        entry_price REAL,
        market_yes_price REAL,
        market_no_price REAL,
        stake REAL,
        pnl REAL DEFAULT 0,
        outcome TEXT DEFAULT 'PENDING' CHECK(outcome IN ('WIN', 'LOSS', 'PENDING')),
        reasons TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_ws ON trades(window_start);

      -- System state (key-value store)
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );

      INSERT INTO schema_version (version) VALUES (1);
    `);
  }

  if (version < 2) {
    logger.info('Applying migration v2: add btc prices to trades');
    db.exec(`
            ALTER TABLE trades ADD COLUMN btc_price_entry REAL;
            ALTER TABLE trades ADD COLUMN btc_price_close REAL;
            INSERT INTO schema_version (version) VALUES (2);
        `);
  }

  if (version < 3) {
    logger.info('Applying migration v3: paper strategy window signals');
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_strategy_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('PAPER', 'LIVE')),
        strategy TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('UP', 'DOWN', 'NO_TRADE')),
        confidence REAL NOT NULL,
        p_up REAL NOT NULL,
        edge REAL NOT NULL,
        should_trade INTEGER NOT NULL CHECK(should_trade IN (0, 1)),
        decision_reason TEXT NOT NULL,
        reasons TEXT NOT NULL,
        trade_id INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pss_unique_window_strategy
        ON paper_strategy_signals(window_start, mode, strategy);
      CREATE INDEX IF NOT EXISTS idx_pss_mode_window
        ON paper_strategy_signals(mode, window_start DESC);
      CREATE INDEX IF NOT EXISTS idx_pss_strategy_window
        ON paper_strategy_signals(strategy, window_start DESC);

      INSERT INTO schema_version (version) VALUES (3);
    `);
  }
}
