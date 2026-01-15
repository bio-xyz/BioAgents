import { createTokenUsage } from "../db/operations";
import logger from "../utils/logger";
import { LLMAdapter } from "./adapter";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GoogleAdapter } from "./adapters/google";
import { OpenAIAdapter } from "./adapters/openai";
import { OpenRouterAdapter } from "./adapters/openrouter";
import { withRetry } from "./retry";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WebSearchResponse,
} from "./types";

export class LLM {
  private adapter: LLMAdapter;
  private provider: LLMProvider;
  private providerName: string;

  constructor(provider: LLMProvider) {
    this.provider = provider;
    this.adapter = this.createAdapter(provider);
    this.providerName = provider.name;
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      // Try with retries on primary provider
      const result = await withRetry(
        () => this.adapter.createChatCompletion(request),
        this.providerName
      );

      const duration = Date.now() - startTime;
      (this.adapter as any).logDuration("createChatCompletion", duration);
      this.trackTokenUsage(result, request, duration);
      this.checkFinishReason(result, request);
      return result;
    } catch (error: any) {
      // Check if we need to try fallback provider
      if (error.requiresFallback) {
        return this.attemptFallbackCompletion(request, startTime, error);
      }
      throw error;
    }
  }

  private async attemptFallbackCompletion(
    request: LLMRequest,
    startTime: number,
    error: any
  ): Promise<LLMResponse> {
    const fallbackProvider = error.fallbackProvider as string;
    const fallbackModel = error.fallbackModel as string;
    const fallbackApiKey = this.getFallbackApiKey(fallbackProvider);

    if (!fallbackApiKey) {
      logger.error(
        { fallbackProvider },
        "llm_fallback_api_key_not_configured"
      );
      throw error.originalError;
    }

    logger.info(
      {
        originalProvider: this.providerName,
        fallbackProvider,
        fallbackModel,
        originalModel: request.model,
      },
      "llm_attempting_fallback"
    );

    const fallbackLLMProvider: LLMProvider = {
      name: fallbackProvider as LLMProvider["name"],
      apiKey: fallbackApiKey,
    };
    const fallbackAdapter = this.createAdapter(fallbackLLMProvider);

    // Modify request to use fallback model
    const fallbackRequest: LLMRequest = {
      ...request,
      model: fallbackModel,
    };

    try {
      const result = await fallbackAdapter.createChatCompletion(fallbackRequest);
      const duration = Date.now() - startTime;
      (fallbackAdapter as any).logDuration(
        "createChatCompletion (fallback)",
        duration
      );
      this.trackTokenUsage(result, fallbackRequest, duration, fallbackProvider);
      this.checkFinishReason(result, fallbackRequest);

      logger.info(
        { fallbackProvider, fallbackModel },
        "llm_fallback_success"
      );
      return result;
    } catch (fallbackError) {
      logger.error(
        {
          originalProvider: this.providerName,
          fallbackProvider,
          fallbackError:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        },
        "llm_fallback_failed"
      );
      // Throw the original error since fallback also failed
      throw error.originalError;
    }
  }

  async createChatCompletionWebSearch(
    request: LLMRequest
  ): Promise<WebSearchResponse> {
    const startTime = Date.now();

    try {
      // Try with retries on primary provider
      const result = await withRetry(
        () => this.adapter.createChatCompletionWebSearch(request),
        this.providerName
      );

      const duration = Date.now() - startTime;
      (this.adapter as any).logDuration(
        "createChatCompletionWebSearch",
        duration
      );
      return result;
    } catch (error: any) {
      // Check if we need to try fallback provider
      if (error.requiresFallback) {
        return this.attemptFallbackWebSearch(request, startTime, error);
      }
      throw error;
    }
  }

  private async attemptFallbackWebSearch(
    request: LLMRequest,
    startTime: number,
    error: any
  ): Promise<WebSearchResponse> {
    const fallbackProvider = error.fallbackProvider as string;
    const fallbackModel = error.fallbackModel as string;
    const fallbackApiKey = this.getFallbackApiKey(fallbackProvider);

    if (!fallbackApiKey) {
      logger.error(
        { fallbackProvider },
        "llm_fallback_api_key_not_configured"
      );
      throw error.originalError;
    }

    logger.info(
      {
        originalProvider: this.providerName,
        fallbackProvider,
        fallbackModel,
      },
      "llm_attempting_fallback_websearch"
    );

    const fallbackLLMProvider: LLMProvider = {
      name: fallbackProvider as LLMProvider["name"],
      apiKey: fallbackApiKey,
    };
    const fallbackAdapter = this.createAdapter(fallbackLLMProvider);

    const fallbackRequest: LLMRequest = {
      ...request,
      model: fallbackModel,
    };

    try {
      const result =
        await fallbackAdapter.createChatCompletionWebSearch(fallbackRequest);
      const duration = Date.now() - startTime;
      (fallbackAdapter as any).logDuration(
        "createChatCompletionWebSearch (fallback)",
        duration
      );

      logger.info(
        { fallbackProvider, fallbackModel },
        "llm_fallback_websearch_success"
      );
      return result;
    } catch (fallbackError) {
      logger.error(
        {
          originalProvider: this.providerName,
          fallbackProvider,
          fallbackError:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        },
        "llm_fallback_websearch_failed"
      );
      throw error.originalError;
    }
  }

  private getFallbackApiKey(provider: string): string | undefined {
    const envKey = `${provider.toUpperCase()}_API_KEY`;
    return process.env[envKey];
  }

  // Normal finish reasons by provider (case-insensitive comparison)
  private static readonly NORMAL_FINISH_REASONS = new Set([
    "stop",        // OpenAI, OpenRouter
    "end_turn",    // Anthropic
    "STOP",        // Google
  ]);

  private checkFinishReason(result: LLMResponse, request: LLMRequest): void {
    if (!result.finishReason) return;

    const isNormal = LLM.NORMAL_FINISH_REASONS.has(result.finishReason);
    if (!isNormal) {
      // Get the last user message as the prompt preview
      const lastUserMessage = [...request.messages].reverse().find(m => m.role === "user");
      const promptPreview = lastUserMessage?.content?.slice(0, 500);

      logger.warn(
        {
          finishReason: result.finishReason,
          provider: this.providerName,
          model: request.model,
          maxTokens: request.maxTokens,
          contentLength: result.content?.length,
          contentPreview: result.content?.slice(-100),
          promptPreview,
          promptLength: lastUserMessage?.content?.length,
        },
        "llm_response_truncated_or_abnormal_finish"
      );
    }
  }

  private trackTokenUsage(
    result: LLMResponse,
    request: LLMRequest,
    duration: number,
    providerOverride?: string
  ): void {
    if (
      result.usage &&
      request.usageType &&
      (request.messageId || request.paperId)
    ) {
      createTokenUsage({
        message_id: request.messageId,
        paper_id: request.paperId,
        type: request.usageType,
        provider: providerOverride || this.providerName,
        model: request.model,
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
        duration_ms: duration,
      }).catch((err) => {
        logger.warn(
          { err, messageId: request.messageId, paperId: request.paperId },
          "failed_to_save_token_usage_to_db"
        );
      });
    }
  }

  private createAdapter(provider: LLMProvider): LLMAdapter {
    switch (provider.name) {
      case "openai":
        return new OpenAIAdapter(provider);
      case "google":
        return new GoogleAdapter(provider);
      case "anthropic":
        return new AnthropicAdapter(provider);
      case "openrouter":
        return new OpenRouterAdapter(provider);
      default:
        throw new Error(`Unsupported provider: ${provider.name}`);
    }
  }
}
