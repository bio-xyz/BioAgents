import { createTokenUsage } from "../db/operations";
import logger from "../utils/logger";
import { LLMAdapter } from "./adapter";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GoogleAdapter } from "./adapters/google";
import { OpenAIAdapter } from "./adapters/openai";
import { OpenRouterAdapter } from "./adapters/openrouter";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WebSearchResponse,
} from "./types";

export class LLM {
  private adapter: LLMAdapter;
  private providerName: string;

  constructor(provider: LLMProvider) {
    this.adapter = this.createAdapter(provider);
    this.providerName = provider.name;
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const result = await this.adapter.createChatCompletion(request);
    const duration = Date.now() - startTime;
    (this.adapter as any).logDuration("createChatCompletion", duration);

    // Save token usage to database if tracking info is provided
    if (result.usage && request.usageType && (request.messageId || request.paperId)) {
      createTokenUsage({
        message_id: request.messageId,
        paper_id: request.paperId,
        type: request.usageType,
        provider: this.providerName,
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

    return result;
  }

  async createChatCompletionWebSearch(
    request: LLMRequest,
  ): Promise<WebSearchResponse> {
    const startTime = Date.now();
    const result = await this.adapter.createChatCompletionWebSearch(request);
    const duration = Date.now() - startTime;
    (this.adapter as any).logDuration(
      "createChatCompletionWebSearch",
      duration,
    );

    return result;
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
