// ============================================
// Tests — Scheduler (Time Utilities)
// ============================================

import { describe, it, expect } from 'vitest';
import {
    getCurrentWindowStart,
    getCurrentWindowEnd,
    msUntilNextWindow,
    secondsIntoCurrentWindow,
    alignToWindow,
    getUTCDayStart,
    isPastCutoff,
} from '../src/utils/time.js';

describe('Time Utilities', () => {
    describe('alignToWindow', () => {
        it('aligns to 5-minute boundary', () => {
            // 2023-11-15 10:07:30 UTC = should align to 10:05
            const ts = new Date('2023-11-15T10:07:30Z').getTime();
            const aligned = alignToWindow(ts, 5);
            const alignedDate = new Date(aligned);
            expect(alignedDate.getUTCMinutes()).toBe(5);
            expect(alignedDate.getUTCSeconds()).toBe(0);
        });

        it('keeps already aligned timestamp', () => {
            const ts = new Date('2023-11-15T10:05:00Z').getTime();
            const aligned = alignToWindow(ts, 5);
            expect(aligned).toBe(ts);
        });

        it('aligns to 1-minute boundary', () => {
            const ts = new Date('2023-11-15T10:07:30Z').getTime();
            const aligned = alignToWindow(ts, 1);
            const alignedDate = new Date(aligned);
            expect(alignedDate.getUTCMinutes()).toBe(7);
            expect(alignedDate.getUTCSeconds()).toBe(0);
        });
    });

    describe('getCurrentWindowStart', () => {
        it('returns a timestamp aligned to window', () => {
            const result = getCurrentWindowStart(5);
            expect(result % (5 * 60 * 1000)).toBe(0);
        });

        it('is less than or equal to now', () => {
            const result = getCurrentWindowStart(5);
            expect(result).toBeLessThanOrEqual(Date.now());
        });
    });

    describe('getCurrentWindowEnd', () => {
        it('is exactly windowMinutes after start', () => {
            const start = getCurrentWindowStart(5);
            const end = getCurrentWindowEnd(5);
            expect(end - start).toBe(5 * 60 * 1000);
        });
    });

    describe('msUntilNextWindow', () => {
        it('returns positive value', () => {
            const result = msUntilNextWindow(5);
            expect(result).toBeGreaterThan(0);
        });

        it('is less than or equal to window size', () => {
            const result = msUntilNextWindow(5);
            expect(result).toBeLessThanOrEqual(5 * 60 * 1000);
        });
    });

    describe('secondsIntoCurrentWindow', () => {
        it('returns value between 0 and windowMinutes*60', () => {
            const result = secondsIntoCurrentWindow(5);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(5 * 60);
        });
    });

    describe('getUTCDayStart', () => {
        it('returns midnight UTC', () => {
            const result = getUTCDayStart();
            const date = new Date(result);
            expect(date.getUTCHours()).toBe(0);
            expect(date.getUTCMinutes()).toBe(0);
            expect(date.getUTCSeconds()).toBe(0);
        });
    });
});
