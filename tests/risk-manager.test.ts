// ============================================
// Tests — Risk Manager
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultRiskManager } from '../src/risk/manager.js';
import type { Signal, AccountState, TradeRecord, BotConfig } from '../src/types/index.js';

const defaultRiskConfig: BotConfig['risk'] = {
    maxStakePerTrade: 5,
    maxDailyLoss: 20,
    maxOpenPositions: 1,
    cooldownAfterLosses: 3,
    slippageTolerance: 0.03,
    minEdgeThreshold: 0.02,
    spreadMaxTolerance: 0.10,
};

function makeSignal(overrides: Partial<Signal> = {}): Signal {
    return {
        direction: 'UP',
        confidence: 0.6,
        pUp: 0.65,
        edge: 0.05,
        reasons: ['test'],
        strategyName: 'test',
        timestamp: Date.now(),
        ...overrides,
    };
}

function makeAccountState(overrides: Partial<AccountState> = {}): AccountState {
    return {
        balance: 100,
        dailyPnL: 0,
        openPositions: 0,
        consecutiveLosses: 0,
        tradesThisWindow: 0,
        ...overrides,
    };
}

describe('Risk Manager', () => {
    let rm: DefaultRiskManager;

    beforeEach(() => {
        rm = new DefaultRiskManager(defaultRiskConfig);
    });

    it('allows valid trade', () => {
        const signal = makeSignal();
        const account = makeAccountState();
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(true);
        expect(decision.adjustedStake).toBeGreaterThan(0);
        expect(decision.adjustedStake).toBeLessThanOrEqual(5);
    });

    it('rejects NO_TRADE signal', () => {
        const signal = makeSignal({ direction: 'NO_TRADE' });
        const decision = rm.canTrade(signal, makeAccountState());
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('NO_TRADE');
    });

    it('rejects low edge', () => {
        const signal = makeSignal({ edge: 0.01 });
        const decision = rm.canTrade(signal, makeAccountState());
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Edge');
    });

    it('rejects when max open positions reached', () => {
        const signal = makeSignal();
        const account = makeAccountState({ openPositions: 1 });
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('open positions');
    });

    it('rejects when already traded in window', () => {
        const signal = makeSignal();
        const account = makeAccountState({ tradesThisWindow: 1 });
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Already traded');
    });

    it('enters cooldown after consecutive losses', () => {
        const signal = makeSignal();
        const account = makeAccountState();

        // Record 3 consecutive losses
        for (let i = 0; i < 3; i++) {
            rm.recordTrade({
                timestamp: Date.now(),
                windowStart: 0,
                mode: 'PAPER',
                strategy: 'test',
                direction: 'UP',
                confidence: 0.5,
                edge: 0.03,
                entryPrice: 0.5,
                marketYesPrice: 0.5,
                marketNoPrice: 0.5,
                stake: 5,
                pnl: -5,
                outcome: 'LOSS',
                reasons: [],
            });
        }

        expect(rm.getConsecutiveLosses()).toBe(3);
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(false);
    });

    it('does not re-enter cooldown loop without new losses', () => {
        const signal = makeSignal();
        const account = makeAccountState();

        for (let i = 0; i < 3; i++) {
            rm.recordTrade({
                timestamp: Date.now(),
                windowStart: 0,
                mode: 'PAPER',
                strategy: 'test',
                direction: 'UP',
                confidence: 0.5,
                edge: 0.03,
                entryPrice: 0.5,
                marketYesPrice: 0.5,
                marketNoPrice: 0.5,
                stake: 5,
                pnl: -5,
                outcome: 'LOSS',
                reasons: [],
            });
        }

        const firstDecision = rm.canTrade(signal, account);
        expect(firstDecision.allowed).toBe(false);
        expect(firstDecision.reason).toContain('Entering cooldown');

        (rm as unknown as { cooldownUntil: number }).cooldownUntil = Date.now() - 1;

        const secondDecision = rm.canTrade(signal, account);
        expect(secondDecision.allowed).toBe(true);
    });

    it('rejects when daily loss limit reached', () => {
        // Simulate large daily loss
        rm.recordTrade({
            timestamp: Date.now(),
            windowStart: 0,
            mode: 'PAPER',
            strategy: 'test',
            direction: 'UP',
            confidence: 0.5,
            edge: 0.03,
            entryPrice: 0.5,
            marketYesPrice: 0.5,
            marketNoPrice: 0.5,
            stake: 20,
            pnl: -20,
            outcome: 'LOSS',
            reasons: [],
        });

        const signal = makeSignal();
        const account = makeAccountState();
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Daily loss');
    });

    it('resets consecutive losses on win', () => {
        // Record some losses
        for (let i = 0; i < 2; i++) {
            rm.recordTrade({
                timestamp: Date.now(),
                windowStart: 0,
                mode: 'PAPER',
                strategy: 'test',
                direction: 'UP',
                confidence: 0.5,
                edge: 0.03,
                entryPrice: 0.5,
                marketYesPrice: 0.5,
                marketNoPrice: 0.5,
                stake: 5,
                pnl: -5,
                outcome: 'LOSS',
                reasons: [],
            });
        }
        expect(rm.getConsecutiveLosses()).toBe(2);

        // Record a win
        rm.recordTrade({
            timestamp: Date.now(),
            windowStart: 0,
            mode: 'PAPER',
            strategy: 'test',
            direction: 'UP',
            confidence: 0.5,
            edge: 0.03,
            entryPrice: 0.5,
            marketYesPrice: 0.5,
            marketNoPrice: 0.5,
            stake: 5,
            pnl: 5,
            outcome: 'WIN',
            reasons: [],
        });
        expect(rm.getConsecutiveLosses()).toBe(0);
    });

    it('scales stake down for low confidence', () => {
        const signal = makeSignal({ confidence: 0.2 });
        const account = makeAccountState();
        const decision = rm.canTrade(signal, account);
        expect(decision.allowed).toBe(true);
        // 0.2 < 0.3 → stake * 0.5
        expect(decision.adjustedStake).toBeCloseTo(2.5);
    });
});
