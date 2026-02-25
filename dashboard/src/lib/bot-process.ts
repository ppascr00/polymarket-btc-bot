import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';

interface BotPidInfo {
    pid: number;
    startedAt: number;
}

function getRepoRoot(): string {
    return path.resolve(process.cwd(), '..');
}

function getPidFilePath(): string {
    return path.join(getRepoRoot(), 'data', 'bot-process.json');
}

function getDbPath(): string {
    const repoRoot = getRepoRoot();
    const configured = process.env.DB_PATH || './data/bot.db';
    if (path.isAbsolute(configured)) return configured;
    return path.resolve(repoRoot, configured);
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

export function getBotProcessStatus(): { running: boolean; pid: number | null } {
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
