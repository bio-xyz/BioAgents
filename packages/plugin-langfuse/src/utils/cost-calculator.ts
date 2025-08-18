import type { CostCalculation } from '../constants/types';
import { MODEL_COSTS } from '../constants/constants';

/**
 * Calculate the cost for a model based on input and output tokens
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): CostCalculation {
    // Normalize model name for lookup
    const modelKey = Object.keys(MODEL_COSTS).find(key =>
        model.toLowerCase().includes(key.toLowerCase())
    ) || 'default';

    const costs = MODEL_COSTS[modelKey] || MODEL_COSTS.default;
    const inputCost = (inputTokens / 1000) * costs.input;
    const outputCost = (outputTokens / 1000) * costs.output;
    const totalCost = inputCost + outputCost;

    return {
        inputCost,
        outputCost,
        totalCost,
        model: modelKey,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
    };
}

/**
 * Calculate cost efficiency score (normalized against 10 cents baseline)
 */
export function calculateCostEfficiency(totalCost: number, baseline: number = 0.1): number {
    return Math.max(0, 1 - (totalCost / baseline));
} 