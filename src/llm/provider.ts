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

/**
 * Creates an LLMProvider configuration from a provider name.
 * Handles API key lookup and baseUrl configuration for Featherless.
 */
export function createLLMProvider(providerName: string): LLMProvider {
  const apiKeyEnvVar =
    providerName === "featherless"
      ? "FEATHERLESS_API_KEY"
      : `${providerName.toUpperCase()}_API_KEY`;

  const apiKey = process.env[apiKeyEnvVar];

  console.log(`[createLLMProvider] Creating provider: ${providerName}`);
  console.log(`[createLLMProvider] Looking for API key in: ${apiKeyEnvVar}`);
  console.log(`[createLLMProvider] API key found: ${!!apiKey}`);

  if (!apiKey) {
    throw new Error(`${apiKeyEnvVar} is not configured.`);
  }

  const provider: LLMProvider = {
    name: providerName as LLMProvider["name"],
    apiKey,
  };

  // Set baseUrl for Featherless
  if (providerName === "featherless") {
    provider.baseUrl = "https://api.featherless.ai/v1";
    console.log(
      `[createLLMProvider] Set baseUrl for featherless: ${provider.baseUrl}`,
    );
  }

  console.log(`[createLLMProvider] Final provider config:`, {
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: !!provider.apiKey,
  });

  return provider;
}

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
      case "featherless":
        // Featherless is OpenAI-compatible, use OpenAIAdapter with Featherless base URL
        return new OpenAIAdapter({
          ...provider,
          baseUrl: provider.baseUrl || "https://api.featherless.ai/v1",
        });
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
