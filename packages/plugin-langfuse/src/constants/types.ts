import type { ModelTypeName } from '@elizaos/core';

export interface ModelCost {
    input: number;
    output: number;
}

export interface CostCalculation {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface CostSummary {
    totalCosts: number;
    sessionCosts: Record<string, number>;
    isEnabled: boolean;
    skippedEmbeddingCalls: number;
}

export interface LangfuseConfig {
    secretKey: string;
    publicKey: string;
    baseUrl: string;
    flushAt: number;
    flushInterval: number;
}

export type ModelCostMapping = Record<string, ModelCost>;
export type ModelTypeMapping = Record<ModelTypeName, string[]>; 