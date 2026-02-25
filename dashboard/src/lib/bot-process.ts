import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';

interface BotPidInfo {
    pid: number;
    startedAt: number;
}

type ProcessManagerMode = 'local' | 'docker';

function getRepoRoot(): string {
    return path.resolve(process.cwd(), '..');
}

function getProcessManagerMode(): ProcessManagerMode {
    const configured = (process.env.BOT_PROCESS_MANAGER || '').trim().toLowerCase();
    if (configured === 'docker') return 'docker';
    if (configured === 'local') return 'local';

    if (fs.existsSync('/.dockerenv')) {
        return 'docker';
    }

    return 'local';
}

export function isDockerProcessManager(): boolean {
    return getProcessManagerMode() === 'docker';
}

function getPidFilePath(): string {
    return path.join(getRepoRoot(), 'data', 'bot-process.json');
}

function getDbPath(): string {
    const configured = process.env.DB_PATH || './data/bot.db';
    if (path.isAbsolute(configured)) return configured;

    if (isDockerProcessManager()) {
        return path.resolve(process.cwd(), configured);
    }

    return path.resolve(getRepoRoot(), configured);
}

function getActiveMode(): 'PAPER' | 'LIVE' {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
        const raw = (process.env.TRADING_MODE || 'PAPER').toUpperCase();
        return raw === 'LIVE' ? 'LIVE' : 'PAPER';
    }

    try {
        const db = new Database(dbPath, { readonly: true });
        const row = db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get('trading_mode_active') as { value?: string } | undefined;
        db.close();
        const raw = (row?.value || process.env.TRADING_MODE || 'PAPER').toUpperCase();
        return raw === 'LIVE' ? 'LIVE' : 'PAPER';
    } catch {
        const raw = (process.env.TRADING_MODE || 'PAPER').toUpperCase();
        return raw === 'LIVE' ? 'LIVE' : 'PAPER';
    }
}

function readPidInfo(): BotPidInfo | null {
    const pidFile = getPidFilePath();
    if (!fs.existsSync(pidFile)) return null;

    try {
        const raw = fs.readFileSync(pidFile, 'utf-8');
        const parsed = JSON.parse(raw) as BotPidInfo;
        if (typeof parsed.pid !== 'number') return null;
        return parsed;
    } catch {
        return null;
    }
}

function writePidInfo(info: BotPidInfo): void {
    const pidFile = getPidFilePath();
    const dir = path.dirname(pidFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(pidFile, JSON.stringify(info), 'utf-8');
}

function clearPidInfo(): void {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
    }
}

function isPidRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function setPausedState(paused: boolean): boolean {
    const dbPath = getDbPath();

    try {
        const db = new Database(dbPath);
        db.prepare(
            `INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('paused', ?, ?)`
        ).run(String(paused), Date.now());
        db.close();
        return true;
    } catch {
        return false;
    }
}

function getRuntimeState(): {
    dbOk: boolean;
    heartbeatFresh: boolean;
    paused: boolean;
} {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
        return { dbOk: false, heartbeatFresh: false, paused: false };
    }

    try {
        const db = new Database(dbPath, { readonly: true });

        const heartbeatRow = db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get('last_heartbeat') as { value?: string } | undefined;

        const pausedRow = db
            .prepare('SELECT value FROM system_state WHERE key = ?')
            .get('paused') as { value?: string } | undefined;

        db.close();

        const lastHeartbeat = Number.parseInt(heartbeatRow?.value || '0', 10);
        const heartbeatFresh = Number.isFinite(lastHeartbeat)
            && lastHeartbeat > 0
            && (Date.now() - lastHeartbeat) < 90_000;

        return {
            dbOk: true,
            heartbeatFresh,
            paused: pausedRow?.value === 'true',
        };
    } catch {
        return { dbOk: false, heartbeatFresh: false, paused: false };
    }
}

export function getBotProcessStatus(): { running: boolean; pid: number | null } {
    if (isDockerProcessManager()) {
        const runtime = getRuntimeState();
        // In Docker mode, "running" means active (heartbeat fresh and not paused).
        return { running: runtime.dbOk && runtime.heartbeatFresh && !runtime.paused, pid: null };
    }

    const info = readPidInfo();
    if (!info) return { running: false, pid: null };

    const running = isPidRunning(info.pid);
    if (!running) {
        clearPidInfo();
        return { running: false, pid: null };
    }

    return { running: true, pid: info.pid };
}

export function startBotProcess(): { started: boolean; pid: number | null; message: string } {
    if (isDockerProcessManager()) {
        const runtime = getRuntimeState();
        if (!runtime.dbOk) {
            return {
                started: false,
                pid: null,
                message: 'DB unavailable. Ensure dashboard has write access to /app/data.',
            };
        }

        if (!runtime.paused && runtime.heartbeatFresh) {
            return { started: false, pid: null, message: 'Bot is already running' };
        }

        if (!setPausedState(false)) {
            return {
                started: false,
                pid: null,
                message: 'Failed to update paused state in DB.',
            };
        }

        if (!runtime.heartbeatFresh) {
            return {
                started: false,
                pid: null,
                message: 'Bot service heartbeat is missing. Start bot container with: docker compose up -d bot',
            };
        }

        return { started: true, pid: null, message: 'Bot resumed' };
    }

    const current = getBotProcessStatus();
    if (current.running) {
        return { started: false, pid: current.pid, message: 'Bot is already running' };
    }

    const repoRoot = getRepoRoot();
    const activeMode = getActiveMode();
    const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const entry = path.join(repoRoot, 'src', 'index.ts');
    const logPath = path.join(repoRoot, 'data', 'bot-run.log');

    if (!fs.existsSync(tsxCli)) {
        return { started: false, pid: null, message: 'tsx not found. Run npm install in repo root.' };
    }

    const outFd = fs.openSync(logPath, 'a');

    const child = spawn(process.execPath, [tsxCli, entry], {
        cwd: repoRoot,
        detached: false,
        stdio: ['ignore', outFd, outFd],
        windowsHide: true,
        env: {
            ...process.env,
            TRADING_MODE: activeMode,
        },
    });
    fs.closeSync(outFd);

    if (!child.pid) {
        return { started: false, pid: null, message: 'Failed to start bot process' };
    }

    child.unref();
    writePidInfo({ pid: child.pid, startedAt: Date.now() });
    return { started: true, pid: child.pid, message: `Bot started in ${activeMode} mode` };
}

export async function stopBotProcess(): Promise<{ stopped: boolean; message: string }> {
    if (isDockerProcessManager()) {
        const runtime = getRuntimeState();
        if (!runtime.dbOk) {
            return { stopped: false, message: 'DB unavailable. Ensure dashboard can access /app/data/bot.db.' };
        }

        if (runtime.paused) {
            return { stopped: false, message: 'Bot is already stopped' };
        }

        if (!setPausedState(true)) {
            return { stopped: false, message: 'Failed to update paused state in DB.' };
        }

        if (!runtime.heartbeatFresh) {
            return { stopped: true, message: 'Bot marked as stopped, but heartbeat is currently missing.' };
        }

        return { stopped: true, message: 'Bot paused' };
    }

    const current = getBotProcessStatus();
    if (!current.running || !current.pid) {
        clearPidInfo();
        return { stopped: false, message: 'Bot is not running' };
    }

    const pid = current.pid;

    try {
        if (process.platform === 'win32') {
            await new Promise<void>((resolve, reject) => {
                const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore',
                });
                killer.on('error', reject);
                killer.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`taskkill exited with code ${code}`));
                });
            });
        } else {
            process.kill(-pid, 'SIGTERM');
        }

        clearPidInfo();
        return { stopped: true, message: 'Bot stopped' };
    } catch {
        return { stopped: false, message: 'Failed to stop bot process' };
    }
}
