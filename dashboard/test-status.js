import Database from 'better-sqlite3';

function testAPI() {
    const DB_PATH = '../data/bot.db';
    let db;
    try {
        db = new Database(DB_PATH, { readonly: true });
        console.log("DB connection successful");
    } catch (err) {
        console.error("DB connection error:", err);
        return;
    }

    try {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        const todayStats = db.prepare(`
      SELECT
        COUNT(*) as trades,
        COALESCE(SUM(pnl), 0) as pnl,
        COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) as wins
      FROM trades
      WHERE timestamp >= ?
    `).get(todayMs);

        console.log("Today stats:", todayStats);

        const totalStats = db.prepare(`
      SELECT
        COUNT(*) as trades,
        COALESCE(SUM(pnl), 0) as pnl,
        COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) as wins
      FROM trades
      WHERE outcome != 'PENDING'
    `).get();
    console.log("Total stats:", totalStats);

        const recentTrades = db.prepare(`
      SELECT pnl FROM trades
      WHERE outcome != 'PENDING'
      ORDER BY timestamp DESC
      LIMIT 30
    `).all();

        const recentOutcomes = db.prepare(`
      SELECT outcome FROM trades
      WHERE outcome != 'PENDING'
      ORDER BY timestamp DESC
      LIMIT 20
    `).all();

        let consecutiveLosses = 0;
        for (const r of recentOutcomes) {
            if (r.outcome === 'LOSS') consecutiveLosses++;
            else break;
        }

        const getState = (key) => {
            const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(key);
            return row?.value;
        };
        console.log("Paused state:", getState('paused'));
        
        console.log("All execution succeeded without throwing");

    } catch (e) {
        console.error("Error evaluating DB queries:", e);
    } finally {
        if(db) db.close();
    }
}

testAPI();
