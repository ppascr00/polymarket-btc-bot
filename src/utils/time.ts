// ============================================
// Polymarket BTC Bot — Time Utilities
// ============================================

/**
 * Get the start of the current 5-minute window aligned to UTC.
 */
export function getCurrentWindowStart(windowMinutes: number = 5): number {
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    return Math.floor(now / windowMs) * windowMs;
}

/**
 * Get the end of the current 5-minute window.
 */
export function getCurrentWindowEnd(windowMinutes: number = 5): number {
    return getCurrentWindowStart(windowMinutes) + windowMinutes * 60 * 1000;
}

/**
 * Get milliseconds remaining until the next window boundary.
 */
export function msUntilNextWindow(windowMinutes: number = 5): number {
    return getCurrentWindowEnd(windowMinutes) - Date.now();
}

/**
 * Get the elapsed seconds within the current window.
 */
export function secondsIntoCurrentWindow(windowMinutes: number = 5): number {
    const windowMs = windowMinutes * 60 * 1000;
    return (Date.now() % windowMs) / 1000;
}

/**
 * Check if we've passed the trading cutoff for the current window.
 * Example: if cutoff = 15s, returns true after the first 15 seconds.
 */
export function isPastCutoff(
    cutoffSeconds: number,
    windowMinutes: number = 5
): boolean {
    return secondsIntoCurrentWindow(windowMinutes) >= cutoffSeconds;
}

/**
 * Sleep for ms.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get start of UTC day for a given timestamp.
 */
export function getUTCDayStart(timestamp: number = Date.now()): number {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * Format timestamp to human-readable UTC string.
 */
export function formatUTC(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

/**
 * Align a timestamp to the nearest window boundary (floor).
 */
export function alignToWindow(
    timestamp: number,
    windowMinutes: number = 5
): number {
    const windowMs = windowMinutes * 60 * 1000;
    return Math.floor(timestamp / windowMs) * windowMs;
}
