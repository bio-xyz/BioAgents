import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WebSearchResult,
} from "./types";

export abstract class LLMAdapter {
  protected provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  abstract createChatCompletion(request: LLMRequest): Promise<LLMResponse>;
  abstract createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }>;

  protected abstract transformRequest(request: LLMRequest): unknown;
  protected abstract transformResponse(response: unknown): LLMResponse;

  logDuration(method: string, durationMs: number): void {
    console.log(`[${this.provider.name}] ${method} took ${durationMs}ms`);
  }
}
