import { LLMAdapter } from '../adapter';
import type { LLMProvider, LLMRequest, LLMResponse, WebSearchResult } from '../types';
import { hasUrlInMessages, enrichMessagesWithUrlContent } from './utils';

interface OpenRouterRequestPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
    max_tokens?: number;
    exclude?: boolean;
  };
}

interface OpenRouterAnnotation {
  type: string;
  url_citation?: {
    url: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

interface OpenRouterMessage {
  role: string;
  content: string;
  annotations?: OpenRouterAnnotation[];
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: OpenRouterMessage;
    text?: string;
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenRouterAdapter extends LLMAdapter {
  private readonly baseUrl: string;
  private readonly defaultReasoning?: 'low' | 'medium' | 'high';

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error('OpenRouter provider requires an API key');
    }

    this.baseUrl = (provider.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.defaultReasoning = provider.reasoningEffort;
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const payload = await this.transformRequest(request);
    const response = await this.executeRequest(payload);
    return this.transformResponse(response);
  }

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    const payload = await this.transformRequestWithWebSearch(request);
    const response = await this.executeRequest(payload);
    return this.transformWebSearchResponse(response);
  }

  protected async transformRequest(request: LLMRequest): Promise<OpenRouterRequestPayload> {
    let messages = this.buildMessages(request);

    // Check if any message contains a URL and fetch content
    const hasUrl = hasUrlInMessages(messages);

    // Fetch static content from URLs if present
    if (hasUrl) {
      messages = await enrichMessagesWithUrlContent(messages);
    }

    // Append :online to model name if URL is detected
    const model =
      hasUrl && !request.model.includes(':online') ? `${request.model}:online` : request.model;

    const payload: OpenRouterRequestPayload = {
      model,
      messages,
    };

    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const reasoningEffort = request.reasoningEffort ?? this.defaultReasoning;
    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }

    return payload;
  }

  private async transformRequestWithWebSearch(
    request: LLMRequest
  ): Promise<OpenRouterRequestPayload> {
    let messages = this.buildMessages(request);

    // Check if any message contains a URL and fetch content
    const hasUrl = hasUrlInMessages(messages);

    // Fetch static content from URLs if present
    if (hasUrl) {
      messages = await enrichMessagesWithUrlContent(messages);
    }

    // Append :online to model name for web search
    const model = !request.model.includes(':online') ? `${request.model}:online` : request.model;

    const payload: OpenRouterRequestPayload = {
      model,
      messages,
    };

    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const reasoningEffort = request.reasoningEffort ?? this.defaultReasoning;
    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }

    return payload;
  }

  protected transformResponse(response: OpenRouterResponse): LLMResponse {
    return {
      content: this.extractText(response),
      usage: this.extractUsage(response),
      finishReason: response.choices?.[0]?.finish_reason ?? undefined,
    };
  }

  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemInstruction) {
      messages.push({ role: 'system', content: request.systemInstruction });
    }

    request.messages.forEach((message) => {
      messages.push({ role: message.role, content: message.content });
    });

    return messages;
  }

  private async executeRequest(payload: OpenRouterRequestPayload): Promise<OpenRouterResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      const errCode =
        parsed?.error?.code ?? parsed?.error?.type ?? parsed?.code ?? `HTTP_${res.status}`;
      const errMsg = parsed?.error?.message ?? parsed?.message ?? (raw || res.statusText);

      const errorDetails = {
        url,
        status: res.status,
        statusText: res.statusText,
        code: errCode,
        message: errMsg,
        body: parsed ?? raw,
      };

      console.error('OpenRouter API error response:', errorDetails);

      throw new Error(
        `OpenRouter API error: ${res.status} ${res.statusText} [${errCode}] - ${errMsg}`
      );
    }

    const data = (await res.json()) as OpenRouterResponse;
    return data;
  }

  private extractText(response: OpenRouterResponse): string {
    if (!response?.choices || response.choices.length === 0) {
      return '';
    }

    const choice = response.choices[0];
    return choice.message?.content ?? choice.text ?? '';
  }

  private extractUsage(response: OpenRouterResponse): LLMResponse['usage'] {
    const usage = response.usage;
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

    if (promptTokens || completionTokens || totalTokens) {
      return {
        promptTokens,
        completionTokens,
        totalTokens,
      };
    }

    return undefined;
  }

  private transformWebSearchResponse(response: OpenRouterResponse): {
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults: WebSearchResult[];
  } {
    const llmOutput = this.extractText(response);

    // Extract web search results from annotations
    const webSearchResults = this.extractWebSearchResults(response);

    // Clean the output by removing citation markers like [domain.com]
    const cleanedLLMOutput = llmOutput
      .replace(/\[([a-z0-9.-]+\.[a-z]{2,})\]\([^)]+\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      cleanedLLMOutput,
      llmOutput,
      webSearchResults,
    };
  }

  private extractWebSearchResults(response: OpenRouterResponse): WebSearchResult[] {
    if (!response?.choices || response.choices.length === 0) {
      return [];
    }

    const choice = response.choices[0];
    const annotations = choice.message?.annotations ?? [];

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    annotations.forEach((annotation) => {
      if (annotation.type !== 'url_citation' || !annotation.url_citation) {
        return;
      }

      const citation = annotation.url_citation;
      const url = citation.url;

      if (!url || seen.has(url)) {
        return;
      }

      seen.add(url);
      results.push({
        title: citation.title ?? '',
        url,
        originalUrl: url,
        index: results.length,
      });
    });

    return results;
  }
}
