// ============================================
// Polymarket BTC Bot — Strategy Registry
// ============================================

import { ProbabilisticStrategy } from './probabilistic.js';
import { EmaCrossoverStrategy } from './ema-crossover.js';
import { RsiReversionStrategy } from './rsi-reversion.js';
import { VolatilityBreakoutStrategy } from './volatility-breakout.js';
import { AiAdaptiveStrategy } from './ai-adaptive.js';
import type { Strategy } from '../types/index.js';

const STRATEGIES: Record<string, () => Strategy> = {
    'probabilistic': () => new ProbabilisticStrategy(),
    'ema-crossover': () => new EmaCrossoverStrategy(),
    'rsi-reversion': () => new RsiReversionStrategy(),
    'volatility-breakout': () => new VolatilityBreakoutStrategy(),
    'ai-adaptive': () => new AiAdaptiveStrategy(),
};

/**
 * Factory: create a strategy by name.
 * Throws if unknown.
 */
export function createStrategy(name: string): Strategy {
    const factory = STRATEGIES[name];
    if (!factory) {
        const available = Object.keys(STRATEGIES).join(', ');
        throw new Error(
            `Unknown strategy "${name}". Available: ${available}`
        );
    }
    return factory();
}

/**
 * List all registered strategy names.
 */
export function listStrategies(): string[] {
    return Object.keys(STRATEGIES);
}

/**
 * Register a custom strategy (for extensibility).
 */
export function registerStrategy(
    name: string,
    factory: () => Strategy
): void {
    STRATEGIES[name] = factory;
}
