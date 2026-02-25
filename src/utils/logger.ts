// ============================================
// Polymarket BTC Bot — Pino Logger Setup
// ============================================

import pino from 'pino';

let loggerInstance: pino.Logger | null = null;

export function createLogger(level: string = 'info'): pino.Logger {
    if (loggerInstance) return loggerInstance;

    const forceColorize = process.env.LOG_COLORIZE;
    const colorize =
        forceColorize !== undefined
            ? forceColorize.toLowerCase() === 'true'
            : Boolean(process.stdout.isTTY);

    loggerInstance = pino({
        level,
        transport:
            process.env.NODE_ENV !== 'production'
                ? {
                    target: 'pino-pretty',
                    options: {
                        colorize,
                        translateTime: 'UTC:yyyy-mm-dd HH:MM:ss.l',
                        ignore: 'pid,hostname',
                    },
                }
                : undefined,
        base: {
            service: 'polymarket-btc-bot',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level(label: string) {
                return { level: label };
            },
        },
    });

    return loggerInstance;
}

export function getLogger(): pino.Logger {
    if (!loggerInstance) {
        return createLogger();
    }
    return loggerInstance;
}
