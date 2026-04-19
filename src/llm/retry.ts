import logger from "../utils/logger";
import type { LLMProviderName } from "./types";

export class FallbackError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly fallbackProvider: LLMProviderName,
    public readonly fallbackModel: string,
    public readonly requiresFallback = true
  ) {
    super(message);
    this.name = "FallbackError";
  }
}

/**
 * Retry configuration for LLM calls
 */
export const RETRY_CONFIG = {
  backoffMultiplier: 2,
  fallbackRetries: 1,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  maxRetries: 3,
} as const;

/**
 * Fallback configuration per provider
 * Maps provider → { fallback provider, fallback model }
 * - anthropic → google (gemini-2.5-pro)
 * - google → anthropic (claude-sonnet-4-5-20250514)
 * - openai → google (gemini-2.5-pro)
 */
export const FALLBACK_CONFIG: Record<string, { provider: LLMProviderName; model: string }> = {
  anthropic: { model: "gemini-2.5-pro", provider: "google" },
  google: { model: "claude-sonnet-4-5-20250514", provider: "anthropic" },
  openai: { model: "gemini-2.5-pro", provider: "google" },
  openrouter: { model: "gemini-2.5-pro", provider: "google" },
};

/**
 * Get fallback provider and model for a given provider
 */
export function getFallbackConfig(
  provider: string
): { provider: LLMProviderName; model: string } | null {
  return FALLBACK_CONFIG[provider] || null;
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff
 */
export function calculateBackoffDelay(
  attempt: number,
  config: typeof RETRY_CONFIG = RETRY_CONFIG
): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Rate limit errors
    if (message.includes("rate limit") || message.includes("429")) {
      return true;
    }
    // Server errors (5xx)
    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("server error") ||
      message.includes("internal error")
    ) {
      return true;
    }
    // Network/timeout errors
    if (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up")
    ) {
      return true;
    }
    // Overloaded errors
    if (message.includes("overloaded")) {
      return true;
    }
  }
  return true; // Default to retryable for unknown errors
}

export interface RetryOptions {
  maxRetries?: number;
  enableFallback?: boolean;
  onRetry?: (attempt: number, error: Error, provider: string) => void;
  onFallback?: (originalProvider: string, fallbackProvider: string) => void;
}

/**
 * Execute a function with retry logic and optional provider fallback
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  provider: string,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  const enableFallback = options.enableFallback ?? true;

  let lastError: Error | null = null;

  // Try original provider with retries
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error)) {
        logger.error({ attempt, err: lastError, provider }, "llm_non_retryable_error");
        throw lastError;
      }

      logger.warn(
        {
          attempt: attempt + 1,
          error: lastError.message,
          maxRetries,
          provider,
        },
        "llm_retry_attempt"
      );

      if (options.onRetry) {
        options.onRetry(attempt + 1, lastError, provider);
      }

      if (attempt < maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt);
        logger.info({ delay, provider }, "llm_retry_delay");
        await sleep(delay);
      }
    }
  }

  // All retries failed - try fallback provider if enabled
  if (enableFallback && lastError) {
    const fallbackConfig = getFallbackConfig(provider);
    if (fallbackConfig) {
      logger.warn(
        {
          fallbackModel: fallbackConfig.model,
          fallbackProvider: fallbackConfig.provider,
          originalError: lastError.message,
          originalProvider: provider,
        },
        "llm_fallback_triggered"
      );

      if (options.onFallback) {
        options.onFallback(provider, fallbackConfig.provider);
      }

      throw new FallbackError(
        `PRIMARY_PROVIDER_FAILED:${fallbackConfig.provider}`,
        lastError,
        fallbackConfig.provider,
        fallbackConfig.model
      );
    }
  }

  throw lastError || new Error("All retry attempts failed");
}
