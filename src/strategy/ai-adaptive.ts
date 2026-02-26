// ============================================
// Polymarket BTC Bot - Strategy 5: AI Adaptive
// ============================================
// Lightweight ML strategy:
// - Trains a logistic model on historical features
// - Uses recency weighting so recent windows matter more
// - Outputs P(UP) and trades only when edge and confidence are enough

import { getLogger } from '../utils/logger.js';
import { dotProduct, sigmoid, zScoreNormalize } from '../utils/math.js';
import type { FeatureSet, MarketState, Signal, Strategy } from '../types/index.js';

const logger = getLogger();

interface AiAdaptiveConfig {
    minEdge: number;
    minConfidence: number;
    paperCommission: number;
    liveCommission: number;
    learningRate: number;
    epochs: number;
    l2: number;
    recencyHalfLife: number;
}

interface AdaptiveModel {
    weights: number[];
    bias: number;
    means: number[];
    stds: number[];
}

const FEATURE_NAMES = [
    'ret1m',
    'ret5m',
    'emaGap',
    'rsiMeanRev',
    'volatility',
    'rangeHL',
    'logVolume',
    'midChange',
    'obImbalance',
];

const DEFAULT_CONFIG: AiAdaptiveConfig = {
    minEdge: 0.02,
    minConfidence: 0.2,
    paperCommission: 0.005,
    liveCommission: 0.02,
    learningRate: 0.03,
    epochs: 180,
    l2: 0.0005,
    recencyHalfLife: 48,
};

export class AiAdaptiveStrategy implements Strategy {
    readonly name = 'ai-adaptive';
    private config: AiAdaptiveConfig;
    private model: AdaptiveModel;

    constructor(config: Partial<AiAdaptiveConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.model = this.defaultModel();
    }

    train(historicalData: FeatureSet[]): void {
        if (historicalData.length < 25) {
            logger.warn(
                { dataPoints: historicalData.length, strategy: this.name },
                'AI adaptive: insufficient data, using defaults'
            );
            this.model = this.defaultModel();
            return;
        }

        const vectors = historicalData.map((f) => this.toAdaptiveVector(f));
        const labels = historicalData.map((f) => (f.close > f.open ? 1 : 0));

        const featureCount = vectors[0]!.length;
        const means = new Array<number>(featureCount).fill(0);
        const stds = new Array<number>(featureCount).fill(1);

        for (let j = 0; j < featureCount; j++) {
            const column = vectors.map((v) => v[j]!);
            const normalized = zScoreNormalize(column);
            means[j] = normalized.mean;
            stds[j] = normalized.std || 1;
        }

        const normalizedVectors = vectors.map((row) =>
            row.map((value, idx) => (value - means[idx]!) / stds[idx]!)
        );

        const weights = new Array<number>(featureCount).fill(0);
        let bias = 0;

        for (let epoch = 0; epoch < this.config.epochs; epoch++) {
            const gradW = new Array<number>(featureCount).fill(0);
            let gradB = 0;
            let totalWeight = 0;

            for (let i = 0; i < normalizedVectors.length; i++) {
                const x = normalizedVectors[i]!;
                const y = labels[i]!;
                const age = normalizedVectors.length - 1 - i;
                const sampleWeight = Math.exp(-age / this.config.recencyHalfLife);

                const z = dotProduct(weights, x) + bias;
                const pred = sigmoid(z);
                const err = pred - y;

                for (let j = 0; j < featureCount; j++) {
                    const currentGrad = gradW[j] ?? 0;
                    gradW[j] = currentGrad + sampleWeight * err * x[j]!;
                }
                gradB += sampleWeight * err;
                totalWeight += sampleWeight;
            }

            const denom = Math.max(1e-9, totalWeight);
            for (let j = 0; j < featureCount; j++) {
                const currentWeight = weights[j] ?? 0;
                const regularizedGrad = (gradW[j] ?? 0) / denom + this.config.l2 * currentWeight;
                weights[j] = currentWeight - this.config.learningRate * regularizedGrad;
            }
            bias -= this.config.learningRate * (gradB / denom);
        }

        this.model = {
            weights,
            bias,
            means,
            stds,
        };

        logger.info(
            {
                strategy: this.name,
                dataPoints: historicalData.length,
                features: featureCount,
                weights: weights.map((w) => Number(w.toFixed(4))),
                bias: Number(bias.toFixed(4)),
            },
            'AI adaptive model trained'
        );
    }

    compute(features: FeatureSet, marketState: MarketState): Signal {
        const commission = this.getCommission();
        const adaptiveVector = this.toAdaptiveVector(features);
        const normalized = adaptiveVector.map(
            (value, idx) => (value - this.model.means[idx]!) / this.model.stds[idx]!
        );

        const z = dotProduct(this.model.weights, normalized) + this.model.bias;
        const pUp = sigmoid(z);
        const confidence = Math.min(1, Math.abs(pUp - 0.5) * 2.2);

        const edgeYes = pUp - (marketState.yesPrice + commission);
        const edgeNo = (1 - pUp) - (marketState.noPrice + commission);

        let direction: 'UP' | 'DOWN' | 'NO_TRADE' = 'NO_TRADE';
        let edge = 0;
        const reasons: string[] = [];

        const contributions = normalized.map((value, idx) => ({
            name: FEATURE_NAMES[idx]!,
            contribution: value * this.model.weights[idx]!,
            rawValue: adaptiveVector[idx]!,
        }));
        contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

        if (confidence < this.config.minConfidence) {
            reasons.push(
                `Low confidence ${(confidence * 100).toFixed(1)}% < ${(this.config.minConfidence * 100).toFixed(1)}%`
            );
        } else if (edgeYes >= edgeNo && edgeYes >= this.config.minEdge) {
            direction = 'UP';
            edge = edgeYes;
            reasons.push(`P(UP)=${pUp.toFixed(3)} > market=${marketState.yesPrice.toFixed(3)}+fee`);
            reasons.push(`Edge YES ${(edgeYes * 100).toFixed(1)}%`);
        } else if (edgeNo > edgeYes && edgeNo >= this.config.minEdge) {
            direction = 'DOWN';
            edge = edgeNo;
            reasons.push(`P(DOWN)=${(1 - pUp).toFixed(3)} > market=${marketState.noPrice.toFixed(3)}+fee`);
            reasons.push(`Edge NO ${(edgeNo * 100).toFixed(1)}%`);
        } else {
            reasons.push(
                `No edge: yes ${(edgeYes * 100).toFixed(1)}% / no ${(edgeNo * 100).toFixed(1)}% (min ${(this.config.minEdge * 100).toFixed(1)}%)`
            );
        }

        for (const item of contributions.slice(0, 3)) {
            reasons.push(
                `${item.name}=${item.rawValue.toFixed(4)} (contrib=${item.contribution.toFixed(3)})`
            );
        }

        return {
            direction,
            confidence: direction === 'NO_TRADE' ? 0 : confidence,
            pUp,
            edge,
            reasons,
            strategyName: this.name,
            timestamp: Date.now(),
        };
    }

    private getCommission(): number {
        return process.env.TRADING_MODE === 'PAPER'
            ? this.config.paperCommission
            : this.config.liveCommission;
    }

    private toAdaptiveVector(features: FeatureSet): number[] {
        const emaBase = Math.abs(features.ema8) > 1e-9 ? features.ema8 : 1;
        const emaGap = (features.ema3 - features.ema8) / emaBase;
        const rsiMeanRev = (50 - features.rsi14) / 50;
        const logVolume = Math.log(1 + Math.max(0, features.volume));

        return [
            features.ret1m,
            features.ret5m,
            emaGap,
            rsiMeanRev,
            features.volatility,
            features.rangeHL,
            logVolume,
            features.midChange,
            features.obImbalance,
        ];
    }

    private defaultModel(): AdaptiveModel {
        return {
            weights: [
                0.30,   // ret1m
                0.55,   // ret5m
                0.42,   // emaGap
                0.18,   // rsiMeanRev
                -0.12,  // volatility
                0.10,   // rangeHL
                0.05,   // logVolume
                0.20,   // midChange
                0.16,   // obImbalance
            ],
            bias: 0,
            means: new Array(FEATURE_NAMES.length).fill(0),
            stds: new Array(FEATURE_NAMES.length).fill(1),
        };
    }
}
