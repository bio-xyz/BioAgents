import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WebSearchResponse,
} from "./types";
import { LLMAdapter } from "./adapter";
import { OpenAIAdapter } from "./adapters/openai";
import { AnthropicAdapter } from "./adapters/anthropic";
import { GoogleAdapter } from "./adapters/google";
import { OpenRouterAdapter } from "./adapters/openrouter";

export class LLM {
  private adapter: LLMAdapter;

  constructor(provider: LLMProvider) {
    this.adapter = this.createAdapter(provider);
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const result = await this.adapter.createChatCompletion(request);
    const duration = Date.now() - startTime;
    (this.adapter as any).logDuration("createChatCompletion", duration);
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
