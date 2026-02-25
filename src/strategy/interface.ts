// ============================================
// Polymarket BTC Bot — Strategy Interface
// ============================================

import type { FeatureSet, MarketState, Signal, Strategy } from '../types/index.js';

export type { Strategy, Signal };

/**
 * Re-export the Strategy interface for convenience.
 * All strategies must implement this interface.
 *
 * Lifecycle:
 * 1. Optionally call train() with historical data
 * 2. Call compute() with current features and market state
 * 3. The returned Signal includes direction, confidence, and edge
 *
 * Adding a new strategy:
 * 1. Create a new file in src/strategy/
 * 2. Implement the Strategy interface
 * 3. Register it in registry.ts
 */
