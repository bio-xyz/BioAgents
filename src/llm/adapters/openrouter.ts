import logger from "../../utils/logger";
import { LLMAdapter } from "../adapter";
import type { LLMProvider, LLMRequest, LLMResponse, WebSearchResult } from "../types";
import { enrichMessagesWithUrlContent, hasUrlInMessages } from "./utils";

interface OpenRouterRequestPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  reasoning?: {
    effort?: "low" | "medium" | "high";
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
  private readonly defaultReasoning?: "low" | "medium" | "high";

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error("OpenRouter provider requires an API key");
    }

    this.baseUrl = (provider.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
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
      hasUrl && !request.model.includes(":online") ? `${request.model}:online` : request.model;

    const payload: OpenRouterRequestPayload = {
      messages,
      model,
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
    const model = !request.model.includes(":online") ? `${request.model}:online` : request.model;

    const payload: OpenRouterRequestPayload = {
      messages,
      model,
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
      finishReason: response.choices?.[0]?.finish_reason ?? undefined,
      usage: this.extractUsage(response),
    };
  }

  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemInstruction) {
      messages.push({ content: request.systemInstruction, role: "system" });
    }

    request.messages.forEach((message) => {
      messages.push({ content: message.content, role: message.role });
    });

    return messages;
  }

  private async executeRequest(payload: OpenRouterRequestPayload): Promise<OpenRouterResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "follow",
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      const isRecord = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null;
      const parsedObj = isRecord(parsed) ? parsed : null;
      const errorObj = parsedObj && isRecord(parsedObj.error) ? parsedObj.error : null;
      const errCode =
        (typeof errorObj?.code === "string" ? errorObj.code : undefined) ??
        (typeof errorObj?.type === "string" ? errorObj.type : undefined) ??
        (typeof parsedObj?.code === "string" ? parsedObj.code : undefined) ??
        `HTTP_${res.status}`;
      const errMsg =
        (typeof errorObj?.message === "string" ? errorObj.message : undefined) ??
        (typeof parsedObj?.message === "string" ? parsedObj.message : undefined) ??
        (raw || res.statusText);

      const errorDetails = {
        body: parsed ?? raw,
        code: errCode,
        message: errMsg,
        status: res.status,
        statusText: res.statusText,
        url,
      };

      console.error("OpenRouter API error response:", errorDetails);

      throw new Error(
        `OpenRouter API error: ${res.status} ${res.statusText} [${errCode}] - ${errMsg}`
      );
    }

    const data = (await res.json()) as OpenRouterResponse;
    return data;
  }

  private extractText(response: OpenRouterResponse): string {
    if (!response?.choices || response.choices.length === 0) {
      logger.warn({ hasUsage: !!response?.usage }, "openrouter_empty_choices");
      return "";
    }

    const choice = response.choices[0];
    if (!choice) return "";
    return choice.message?.content ?? choice.text ?? "";
  }

  private extractUsage(response: OpenRouterResponse): LLMResponse["usage"] {
    const usage = response.usage;
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

    if (promptTokens || completionTokens || totalTokens) {
      return {
        completionTokens,
        promptTokens,
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
      .replace(/\[([a-z0-9.-]+\.[a-z]{2,})\]\([^)]+\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return {
      cleanedLLMOutput,
      llmOutput,
      webSearchResults,
    };
  }

  private extractWebSearchResults(response: OpenRouterResponse): WebSearchResult[] {
    if (!response?.choices || response.choices.length === 0) {
      // extractText already warns on the same condition; suppress a duplicate log here.
      return [];
    }

    const choice = response.choices[0];
    if (!choice) return [];
    const annotations = choice.message?.annotations ?? [];

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    annotations.forEach((annotation) => {
      if (annotation.type !== "url_citation" || !annotation.url_citation) {
        return;
      }

      const citation = annotation.url_citation;
      const url = citation.url;

      if (!url || seen.has(url)) {
        return;
      }

      seen.add(url);
      results.push({
        index: results.length,
        originalUrl: url,
        title: citation.title ?? "",
        url,
      });
    });

    return results;
  }
}
