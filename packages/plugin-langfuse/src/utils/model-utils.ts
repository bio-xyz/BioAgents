import { ModelType, type ModelTypeName } from '@elizaos/core';
import { MODEL_TYPE_MAPPING } from '../constants/constants';

/**
 * Get model type from model name using pattern matching
 */
export function getModelTypeFromModelName(modelName: string): ModelTypeName {
    for (const [type, models] of Object.entries(MODEL_TYPE_MAPPING)) {
        if (models.some(model => modelName.toLowerCase().includes(model.toLowerCase()))) {
            return type as ModelTypeName;
        }
    }

    // Fallback based on model name patterns
    if (modelName.includes('embedding')) return ModelType.TEXT_EMBEDDING;
    if (modelName.includes('gpt-4') || modelName.includes('opus')) return ModelType.TEXT_LARGE;
    if (modelName.includes('mini') || modelName.includes('nano') || modelName.includes('haiku')) return ModelType.TEXT_SMALL;

    return ModelType.TEXT_LARGE; // Safe default
}

/**
 * Get expected model name from type and parameters
 * Now better respects runtime configuration
 */
export function getExpectedModelName(modelType: ModelTypeName, params: any): string {
    // Try to extract model from params first (highest priority)
    if (params?.model) return params.model;

    // Check if params has modelProvider info
    if (params?.modelProvider) {
        const providerName = params.modelProvider.toLowerCase();
        const expectedModels = MODEL_TYPE_MAPPING[modelType as keyof typeof MODEL_TYPE_MAPPING];

        // Find the first model that matches the provider
        const matchingModel = expectedModels?.find(model => {
            const modelLower = model.toLowerCase();
            if (providerName.includes('anthropic') || providerName.includes('claude')) {
                return modelLower.includes('claude');
            }
            if (providerName.includes('openai') || providerName.includes('gpt')) {
                return modelLower.includes('gpt');
            }
            if (providerName.includes('google') || providerName.includes('gemini')) {
                return modelLower.includes('gemini');
            }
            return false;
        });

        if (matchingModel) return matchingModel;
    }

    // Fallback to type-based expectations (Claude Opus now prioritized)
    const expectedModels = MODEL_TYPE_MAPPING[modelType as keyof typeof MODEL_TYPE_MAPPING];
    return expectedModels?.[0] || modelType;
} 