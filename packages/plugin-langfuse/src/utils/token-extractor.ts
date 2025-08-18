import type { TokenUsage } from '../constants/types';

/**
 * Extract token usage from various model response formats
 */
export function extractUsageFromResult(result: any): TokenUsage {
    let inputTokens = 0;
    let outputTokens = 0;

    if (result?.usage) {
        inputTokens = result.usage.prompt_tokens || result.usage.promptTokens || result.usage.input_tokens || 0;
        outputTokens = result.usage.completion_tokens || result.usage.completionTokens || result.usage.output_tokens || 0;
    } else if (result?._response?.usage) {
        const usage = result._response.usage;
        inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
        outputTokens = usage.completion_tokens || usage.output_tokens || 0;
    } else if (typeof result === 'string') {
        // Estimate tokens for string responses (rough approximation: 1 token ≈ 4 characters)
        outputTokens = Math.ceil(result.length / 4);
    }

    return { inputTokens, outputTokens };
}

/**
 * Extract actual model name from various response formats
 */
export function getActualModelName(result: any): string | null {
    if (result?.model) return result.model;
    if (result?._response?.model) return result._response.model;
    if (result?.usage?.model) return result.usage.model;
    return null;
} 