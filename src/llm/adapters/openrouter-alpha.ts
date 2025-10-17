import { LLMAdapter } from '../adapter';
import type { LLMProvider, LLMRequest, LLMResponse, LLMTool, WebSearchResult } from '../types';

interface OpenRouterRequestPayload {
  model: string;
  input: Array<{ role: string; content: string }> | string;
  max_output_tokens?: number;
  temperature?: number;
  plugins?: OpenRouterPlugin[];
  reasoning?: {
    effort: 'low' | 'medium' | 'high';
  };
}

interface OpenRouterPlugin {
  id: string;
  [key: string]: unknown;
}

interface OpenRouterResponse {
  output_text?: string;
  aggregated_output_text?: string;
  response?: { output_text?: string };
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        title?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
  data?: Array<{ content?: Array<{ text?: string }> }>;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  metrics?: {
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
  };
  plugins?: Array<{
    id?: string;
    results?: Array<{
      title?: string;
      url?: string;
      original_url?: string;
    }>;
  }>;
  traces?: Array<{
    plugins?: Array<{
      id?: string;
      results?: Array<{
        title?: string;
        url?: string;
        original_url?: string;
      }>;
    }>;
  }>;
}

export class OpenRouterAdapter extends LLMAdapter {
  private readonly baseUrl: string;
  private readonly defaultReasoning?: 'low' | 'medium' | 'high';

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error('OpenRouter provider requires an API key');
    }

    this.baseUrl = (provider.baseUrl ?? 'https://openrouter.ai/api/alpha').replace(/\/$/, '');
    this.defaultReasoning = provider.reasoningEffort;
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const payload = this.transformRequest(request);
    const response = await this.executeRequest(payload);
    return this.transformResponse(response);
  }

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    const requestWithTool = this.ensureWebSearchTool(request);
    const payload = this.transformRequest(requestWithTool);
    const response = await this.executeRequest(payload);

    return this.transformWebSearchResponse(response);
  }

  protected transformRequest(request: LLMRequest): OpenRouterRequestPayload {
    const messages = this.buildInputMessages(request);

    const payload: OpenRouterRequestPayload = {
      model: request.model,
      input:
        messages.length > 0
          ? messages
          : (request.messages[request.messages.length - 1]?.content ?? ''),
    };

    if (request.maxTokens !== undefined) {
      payload.max_output_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    const reasoningEffort = request.reasoningEffort ?? this.defaultReasoning;
    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }

    const plugins = this.mapToolsToPlugins(request.tools);
    if (plugins.length > 0) {
      payload.plugins = plugins;
    }

    return payload;
  }

  protected transformResponse(response: OpenRouterResponse): LLMResponse {
    return {
      content: this.extractText(response),
      usage: this.extractUsage(response),
    };
  }

  private buildInputMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemInstruction) {
      messages.push({ role: 'system', content: request.systemInstruction });
    }

    request.messages.forEach((message) => {
      messages.push({ role: message.role, content: message.content });
    });

    return messages;
  }

  private ensureWebSearchTool(request: LLMRequest): LLMRequest {
    const existingTools = Array.isArray(request.tools) ? [...request.tools] : [];
    const hasWebSearch = existingTools.some((tool) => tool.type === 'webSearch');

    if (hasWebSearch) {
      return request;
    }

    return {
      ...request,
      tools: [...existingTools, { type: 'webSearch' }],
    };
  }

  private async executeRequest(payload: OpenRouterRequestPayload): Promise<OpenRouterResponse> {
    const url = `${this.baseUrl}/chat/completions`; // not /responses
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
      // Read body once
      const raw = await res.text().catch(() => '');
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      // Prefer structured error info when present
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
    if (!response) {
      return '';
    }

    const fragments: string[] = [];

    this.collectTextFragments(response.output_text, fragments);
    this.collectTextFragments(response.aggregated_output_text, fragments);
    this.collectTextFragments(response.response?.output_text, fragments);
    this.collectTextFragments(response.output, fragments);
    this.collectTextFragments(response.data, fragments);
    this.collectTextFragments(
      response.choices?.map((choice) => choice?.message?.content),
      fragments
    );

    return fragments.join('\n').trim();
  }

  private collectTextFragments(value: unknown, fragments: string[]): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        fragments.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => this.collectTextFragments(item, fragments));
      return;
    }

    if (typeof value === 'object') {
      const maybeText = (value as { text?: unknown }).text;
      if (typeof maybeText === 'string') {
        const trimmed = maybeText.trim();
        if (trimmed) {
          fragments.push(trimmed);
        }
      }

      const maybeContent = (value as { content?: unknown }).content;
      if (maybeContent !== undefined) {
        this.collectTextFragments(maybeContent, fragments);
      }

      const maybeMessage = (value as { message?: unknown }).message;
      if (maybeMessage !== undefined) {
        this.collectTextFragments(maybeMessage, fragments);
      }
    }
  }

  private extractUsage(response: OpenRouterResponse): LLMResponse['usage'] {
    const usage = response.usage ?? response.metrics?.tokens;
    if (!usage) {
      return undefined;
    }

    // @ts-ignore
    const promptTokens = usage.input_tokens ?? usage.input ?? 0;
    // @ts-ignore
    const completionTokens = usage.output_tokens ?? usage.output ?? 0;
    // @ts-ignore
    const totalTokens = usage.total_tokens ?? usage.total ?? promptTokens + completionTokens;

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
    const cleanedLLMOutput = this.stripCitationSection(
      llmOutput
        .replace(/(?:,\s*)?\[(?:\d+(?:,\s*\d+)*)\]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    );
    const webSearchResults = this.mergeWebResults(
      this.extractWebSearchResultsFromPlugins(response),
      this.extractWebSearchResultsFromAnnotations(response)
    );

    return {
      cleanedLLMOutput,
      llmOutput,
      webSearchResults,
    };
  }

  private extractWebSearchResultsFromPlugins(response: OpenRouterResponse): WebSearchResult[] {
    const pluginEntries: Array<{ id?: string; results?: Array<Record<string, unknown>> }> = [];

    if (Array.isArray(response.plugins)) {
      pluginEntries.push(...response.plugins);
    }

    if (Array.isArray(response.traces)) {
      for (const trace of response.traces) {
        if (Array.isArray(trace.plugins)) {
          pluginEntries.push(...trace.plugins);
        }
      }
    }

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();
    let index = 0;

    pluginEntries
      .filter((plugin) => plugin?.id === 'web')
      .forEach((plugin) => {
        const pluginResults = Array.isArray(plugin.results) ? plugin.results : [];
        pluginResults.forEach((result) => {
          const url = typeof result.url === 'string' ? result.url : undefined;
          if (!url || seen.has(url)) {
            return;
          }

          seen.add(url);
          results.push({
            title: typeof result.title === 'string' ? result.title : '',
            url,
            originalUrl: typeof result.original_url === 'string' ? result.original_url : url,
            index: index++,
          });
        });
      });

    return results;
  }

  private extractWebSearchResultsFromAnnotations(response: OpenRouterResponse): WebSearchResult[] {
    const results: WebSearchResult[] = [];
    const seen = new Set<string>();
    let index = 0;

    if (Array.isArray(response.output)) {
      response.output.forEach((item) => {
        item.content?.forEach((part) => {
          const annotations = Array.isArray(part.annotations) ? part.annotations : [];
          annotations
            .filter(
              (annotation) =>
                annotation.type === 'url_citation' && typeof annotation.url === 'string'
            )
            .forEach((annotation) => {
              const url = annotation.url as string;
              if (seen.has(url)) {
                return;
              }
              seen.add(url);
              results.push({
                title: typeof annotation.title === 'string' ? annotation.title : '',
                url,
                originalUrl: url,
                index: index++,
              });
            });
        });
      });
    }

    return results;
  }

  private mergeWebResults(
    fromPlugins: WebSearchResult[],
    fromAnnotations: WebSearchResult[]
  ): WebSearchResult[] {
    const combined: WebSearchResult[] = [];
    const seen = new Set<string>();

    [...fromPlugins, ...fromAnnotations].forEach((result) => {
      if (seen.has(result.url)) {
        return;
      }
      seen.add(result.url);
      combined.push({
        ...result,
        index: combined.length,
      });
    });

    return combined;
  }

  private mapToolsToPlugins(tools: LLMTool[] | undefined): OpenRouterPlugin[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    const plugins: OpenRouterPlugin[] = [];
    const seen = new Set<string>();

    tools.forEach((tool) => {
      const plugin = this.mapToolToPlugin(tool);
      if (plugin && !seen.has(plugin.id)) {
        seen.add(plugin.id);
        plugins.push(plugin);
      }
    });

    return plugins;
  }

  private mapToolToPlugin(tool: LLMTool): OpenRouterPlugin | null {
    switch (tool.type) {
      case 'webSearch':
        return { id: 'web', max_results: 3 };
      default:
        return null;
    }
  }

  private stripCitationSection(text: string): string {
    const citationHeaderIndex = text.search(/####\s+Citations/i);
    if (citationHeaderIndex === -1) {
      return text;
    }
    return text.slice(0, citationHeaderIndex).trim();
  }
}
