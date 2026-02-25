// ============================================
// Polymarket BTC Bot — Strategy 1: Probabilistic Model
// ============================================
// Logistic regression–based model trained on historical features.
// Outputs P(UP) and compares against Polymarket implied probability
// to find edge.

import { getLogger } from '../utils/logger.js';
import { sigmoid, dotProduct, zScoreNormalize } from '../utils/math.js';
import { FeatureEngine } from '../data/feature-engine.js';
import type { Strategy, Signal, FeatureSet, MarketState } from '../types/index.js';

const logger = getLogger();

interface ModelWeights {
    weights: number[];
    bias: number;
    featureMeans: number[];
    featureStds: number[];
}

/**
 * Strategy 1: Probabilistic model using logistic regression.
 *
 * - Extracts feature vector from FeatureSet
 * - Normalizes using training statistics
 * - Applies logistic regression: P(UP) = σ(w·x + b)
 * - Compares P(UP) against market implied probability
 * - Trade only if edge > threshold
 */
export class ProbabilisticStrategy implements Strategy {
    readonly name = 'probabilistic';
    private model: ModelWeights | null = null;
    private minEdge: number;

    constructor(minEdge: number = 0.02) {
        this.minEdge = minEdge;
    }

    /**
     * Train the logistic regression model on historical feature data.
     * Uses simple gradient descent.
     */
    train(historicalData: FeatureSet[]): void {
        if (historicalData.length < 20) {
            logger.warn(
                { dataPoints: historicalData.length },
                'Insufficient data for training. Using default weights.'
            );
            this.model = this.defaultWeights();
            return;
        }

        // Prepare training data
        const features: number[][] = [];
        const labels: number[] = [];

        for (const f of historicalData) {
            const vec = FeatureEngine.toVector(f);
            const label = f.close > f.open ? 1 : 0; // UP = 1, DOWN = 0
            features.push(vec);
            labels.push(label);
        }

        // Normalize features
        const numFeatures = features[0]!.length;
        const means: number[] = new Array(numFeatures).fill(0);
        const stds: number[] = new Array(numFeatures).fill(0);

        for (let j = 0; j < numFeatures; j++) {
            const col = features.map((f) => f[j]!);
            const { mean, std } = zScoreNormalize(col);
            means[j] = mean;
            stds[j] = std || 1; // avoid div by zero
        }

        // Normalize
        const normalizedFeatures = features.map((row) =>
            row.map((val, j) => (val - means[j]!) / stds[j]!)
        );

        // Gradient descent for logistic regression
        const weights = new Array(numFeatures).fill(0);
        let bias = 0;
        const learningRate = 0.01;
        const epochs = 200;
        const n = normalizedFeatures.length;

        for (let epoch = 0; epoch < epochs; epoch++) {
            let totalLoss = 0;
            const gradW = new Array(numFeatures).fill(0);
            let gradB = 0;

            for (let i = 0; i < n; i++) {
                const x = normalizedFeatures[i]!;
                const y = labels[i]!;
                const z = dotProduct(weights, x) + bias;
                const pred = sigmoid(z);
                const err = pred - y;

                totalLoss += -y * Math.log(pred + 1e-10) - (1 - y) * Math.log(1 - pred + 1e-10);

                for (let j = 0; j < numFeatures; j++) {
                    gradW[j] += err * x[j]!;
                }
                gradB += err;
            }

            // Update weights
            for (let j = 0; j < numFeatures; j++) {
                weights[j] -= (learningRate * gradW[j]!) / n;
            }
            bias -= (learningRate * gradB) / n;

            if (epoch % 50 === 0) {
                logger.debug(
                    { epoch, loss: totalLoss / n },
                    'Training progress'
                );
            }
        }

        this.model = {
            weights,
            bias,
            featureMeans: means,
            featureStds: stds,
        };

        logger.info(
            {
                dataPoints: n,
                features: numFeatures,
                weights: weights.map((w) => parseFloat(w.toFixed(4))),
                bias: parseFloat(bias.toFixed(4)),
            },
            'Model trained successfully'
        );
    }

    compute(features: FeatureSet, marketState: MarketState): Signal {
        if (!this.model) {
            this.model = this.defaultWeights();
        }

        // Extract and normalize feature vector
        const rawVec = FeatureEngine.toVector(features);
        const normVec = rawVec.map(
            (val, j) =>
                (val - (this.model!.featureMeans[j] ?? 0)) /
                (this.model!.featureStds[j] ?? 1)
        );

        // Predict P(UP)
        const z = dotProduct(this.model.weights, normVec) + this.model.bias;
        const pUp = sigmoid(z);

        // Compare against market implied probability
        const marketPUp = marketState.impliedProbUp;
        const commission = 0.02; // ~2% Polymarket fee

        // Edge calculation:
        // If we think P(UP) > market_price_yes + commission, BUY YES
        // If we think P(DOWN) > market_price_no + commission, BUY NO
        const edgeYes = pUp - (marketState.yesPrice + commission);
        const edgeNo = (1 - pUp) - (marketState.noPrice + commission);

        let direction: 'UP' | 'DOWN' | 'NO_TRADE' = 'NO_TRADE';
        let edge = 0;
        const reasons: string[] = [];

        // Identify top contributing features
        const featureNames = FeatureEngine.featureNames();
        const contributions = normVec.map(
            (v, i) => ({
                name: featureNames[i]!,
                contribution: v * (this.model!.weights[i] ?? 0),
                rawValue: rawVec[i]!,
            })
        );
        contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
        const topFeatures = contributions.slice(0, 3);

        if (edgeYes > this.minEdge && edgeYes >= edgeNo) {
            direction = 'UP';
            edge = edgeYes;
            reasons.push(`P(UP)=${pUp.toFixed(3)} > market=${marketState.yesPrice.toFixed(3)}+fee`);
            reasons.push(`Edge YES: ${(edgeYes * 100).toFixed(1)}%`);
        } else if (edgeNo > this.minEdge && edgeNo > edgeYes) {
            direction = 'DOWN';
            edge = edgeNo;
            reasons.push(`P(DOWN)=${(1 - pUp).toFixed(3)} > market=${marketState.noPrice.toFixed(3)}+fee`);
            reasons.push(`Edge NO: ${(edgeNo * 100).toFixed(1)}%`);
        } else {
            reasons.push(`No sufficient edge: edgeYes=${(edgeYes * 100).toFixed(1)}% edgeNo=${(edgeNo * 100).toFixed(1)}%`);
            reasons.push(`Threshold: ${(this.minEdge * 100).toFixed(1)}%`);
        }

        // Add feature explanations
        for (const f of topFeatures) {
            reasons.push(
                `${f.name}=${f.rawValue.toFixed(4)} (contrib=${f.contribution.toFixed(3)})`
            );
        }

        return {
            direction,
            confidence: direction !== 'NO_TRADE' ? Math.abs(pUp - 0.5) * 2 : 0,
            pUp,
            edge,
            reasons,
            strategyName: this.name,
            timestamp: Date.now(),
        };
    }

    /**
     * Default weights when no training data is available.
     * Conservative: slight bias toward momentum and RSI.
     */
    private defaultWeights(): ModelWeights {
        return {
            weights: [
                0.15,   // ret1m — slight positive
                0.25,   // ret5m — moderate positive (momentum)
                0.05,   // ema3
                -0.05,  // ema8
                -0.10,  // rsi14 — mean-reverting tendency
                -0.05,  // volatility — negative (uncertainty)
                0.0,    // rangeHL
                0.05,   // volume
                0.10,   // obImbalance — buy pressure
                -0.05,  // spread — wider spread = less certain
                0.08,   // midChange
            ],
            bias: 0,
            featureMeans: new Array(11).fill(0),
            featureStds: new Array(11).fill(1),
        };
    }
}
