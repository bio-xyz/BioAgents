import { ModelType } from '@elizaos/core';
import type { ModelCostMapping, ModelTypeMapping } from './types';

// Model cost mapping per 1K tokens (USD) - Updated for 2024/2025 pricing
export const MODEL_COSTS: ModelCostMapping = {
    // OpenAI Models
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },

    // OpenAI GPT-4.1 Models (Released April 14, 2025)
    'gpt-4.1': { input: 0.002, output: 0.008 }, // $2.00/$8.00 per 1M tokens - Full model with 1M context window
    'gpt-4.1-mini': { input: 0.0004, output: 0.0016 }, // $0.40/$1.60 per 1M tokens - Balanced performance/cost
    'gpt-4.1-nano': { input: 0.0001, output: 0.0004 }, // $0.10/$0.40 per 1M tokens - Fastest & most cost-effective

    // OpenAI Embedding Models (Input only - no output cost)
    'text-embedding-ada-002': { input: 0.0001, output: 0 },
    'text-embedding-3-small': { input: 0.00002, output: 0 },
    'text-embedding-3-large': { input: 0.00013, output: 0 },

    // Anthropic Models
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
    'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
    'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
    'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },

    // Anthropic Claude 4 Models (2025)
    'claude-opus-4-20250514': { input: 0.015, output: 0.075 }, // $15.00/$75.00 per 1M tokens

    // OpenAI o-series Models (2024/2025)
    'o1-preview': { input: 0.015, output: 0.06 },
    'o1-mini': { input: 0.003, output: 0.012 },
    'o1': { input: 0.015, output: 0.06 },
    'o3-mini': { input: 0.0011, output: 0.0044 }, // $1.10/$4.40 per 1M tokens
    'o3': { input: 0.002, output: 0.008 }, // $2.00/$8.00 per 1M tokens
    'o3-pro': { input: 0.02, output: 0.08 }, // $20.00/$80.00 per 1M tokens

    // Google Gemini Models (2024/2025)
    'gemini-2.5-flash': { input: 0.00015, output: 0.0006 }, // $0.15/$0.60 per 1M tokens  
    'gemini-2.5-pro': { input: 0.00125, output: 0.01 }, // $1.25/$10.00 per 1M tokens
    'gemini-2.0-flash': { input: 0.0001, output: 0.0004 }, // $0.10/$0.40 per 1M tokens
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 }, // $0.075/$0.30 per 1M tokens (small prompts)
    'gemini-1.5-flash-large': { input: 0.00015, output: 0.0006 }, // $0.15/$0.60 per 1M tokens (large prompts)
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 }, // $1.25/$5.00 per 1M tokens (small prompts)  
    'gemini-1.5-pro-large': { input: 0.0025, output: 0.01 }, // $2.50/$10.00 per 1M tokens (large prompts)
    'gemini-pro': { input: 0.0005, output: 0.0015 },

    // Groq Models
    'llama-3.1-405b-reasoning': { input: 0.0008, output: 0.0008 },
    'llama-3.1-70b-versatile': { input: 0.00059, output: 0.00079 },
    'llama-3.1-8b-instant': { input: 0.00005, output: 0.00008 },

    // DeepSeek Models
    'deepseek-chat': { input: 0.00014, output: 0.00028 },
    'deepseek-coder': { input: 0.00014, output: 0.00028 },

    // Default fallback
    'default': { input: 0.001, output: 0.002 },
};

// Model type to expected model names mapping
export const MODEL_TYPE_MAPPING: ModelTypeMapping = {
    [ModelType.TEXT_LARGE]: ['claude-opus-4-20250514', 'claude-3-5-sonnet-20241022', 'gpt-4.1', 'gpt-4o', 'gpt-4-turbo'],
    [ModelType.TEXT_SMALL]: ['claude-3-5-haiku-20241022', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    [ModelType.TEXT_REASONING_LARGE]: ['claude-opus-4-20250514', 'claude-3-opus-20240229', 'gpt-4.1', 'gpt-4o'],
    [ModelType.TEXT_REASONING_SMALL]: ['claude-3-5-haiku-20241022', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini'],
    [ModelType.TEXT_EMBEDDING]: ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'],
} as const; 