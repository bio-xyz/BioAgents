import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  Response as OpenAIResponse,
  Tool as OpenAITool,
  ResponseCreateParamsStreaming,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseCreateParamsNonStreaming as ResponsesCreateParams,
} from "openai/resources/responses/responses";
import { LLMAdapter } from "../adapter";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMTool,
  WebSearchResult,
} from "../types";

export class OpenAIAdapter extends LLMAdapter {
  private client: OpenAI;

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error("OpenAI provider requires an API key");
    }

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: provider.apiKey,
    };

    if (provider.baseUrl) {
      clientOptions.baseURL = provider.baseUrl;
    }

    this.client = new OpenAI(clientOptions);
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    // If format is provided, use responses.parse for structured output
    if (request.format) {
      return this.createStructuredCompletion(request);
    }

    const transformedRequest = this.transformRequest(request);

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingCompletion(
        transformedRequest,
        request.onStreamChunk,
      );
    }

    try {
      const completion =
        await this.client.chat.completions.create(transformedRequest);
      return this.transformResponse(completion);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenAI chat completion failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async createStreamingCompletion(
    transformedRequest: ChatCompletionCreateParamsNonStreaming,
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<LLMResponse> {
    try {
      const stream = await this.client.chat.completions.create({
        ...transformedRequest,
        stream: true,
      });

      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          fullText += delta;
          await onStreamChunk(delta, fullText);
        }

        // Capture usage if available (usually in the last chunk)
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens || 0;
          completionTokens = chunk.usage.completion_tokens || 0;
        }
      }

      return {
        content: fullText,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenAI streaming completion failed: ${error.message}`);
      }
      throw error;
    }
  }

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    const input = this.buildResponsesInput(request);
    const tools = this.buildWebSearchTools(request.tools);

    const params = {
      model: request.model,
      input,
      instructions: request.systemInstruction ?? undefined,
      tools,
      tool_choice: "auto",
      max_output_tokens: request.maxTokens ?? undefined,
      include: this.getWebSearchInclude(),
    } as ResponsesCreateParams;

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingWebSearch(params, request.onStreamChunk);
    }

    try {
      const response = await this.client.responses.create(params);
      return this.transformWebSearchResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenAI web search failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async createStreamingWebSearch(
    params: ResponsesCreateParams,
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    try {
      const stream = await this.client.responses.create({
        ...params,
        stream: true,
      } as ResponseCreateParamsStreaming);

      let fullText = "";
      let finalResponse: OpenAIResponse | null = null;

      for await (const event of stream) {
        const eventType = (event as any).type;

        // Listen for text delta events (streaming text chunks)
        if (eventType === "response.output_text.delta") {
          const delta = (event as any).delta || "";
          if (delta) {
            fullText += delta;
            await onStreamChunk(delta, fullText);
          }
        }

        // Capture final response for web search results
        if (eventType === "response.completed" || eventType === "response.incomplete") {
          finalResponse = (event as any).response;
        }
      }

      // Use captured final response for web search results
      if (finalResponse) {
        const { webSearchResults } =
          this.transformWebSearchResponse(finalResponse);
        return {
          llmOutput: fullText,
          cleanedLLMOutput: fullText,
          webSearchResults,
        };
      }

      return {
        llmOutput: fullText,
        cleanedLLMOutput: fullText,
        webSearchResults: [],
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenAI streaming web search failed: ${error.message}`);
      }
      throw error;
    }
  }

  protected transformRequest(
    request: LLMRequest,
  ): ChatCompletionCreateParamsNonStreaming {
    const baseMessages: ChatCompletionMessageParam[] = request.messages.map(
      (message) => ({
        role: message.role,
        content: message.content,
      }),
    );

    const messages: ChatCompletionMessageParam[] = request.systemInstruction
      ? [
          { role: "system", content: request.systemInstruction },
          ...baseMessages.filter((msg) => msg.role !== "system"),
        ]
      : baseMessages;

    const openaiRequest: ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages,
    };

    if (request.maxTokens !== undefined) {
      openaiRequest.max_completion_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      openaiRequest.temperature = request.temperature;
    }

    // Map thinkingBudget to reasoning effort for GPT-5.2+ and o-series models
    const reasoningEffort = this.mapThinkingBudgetToReasoningEffort(request.thinkingBudget);
    if (reasoningEffort) {
      (openaiRequest as any).reasoning = { effort: reasoningEffort };
    }

    const mappedTools = this.mapToolsForChat(request.tools);
    if (mappedTools.length > 0) {
      openaiRequest.tools = mappedTools;
    }

    return openaiRequest;
  }

  /**
   * Maps thinkingBudget (token count) to OpenAI reasoning effort level.
   * GPT-5.2+ supports: none, low, medium, high, xhigh
   */
  private mapThinkingBudgetToReasoningEffort(
    thinkingBudget: number | undefined,
  ): "none" | "low" | "medium" | "high" | "xhigh" | undefined {
    if (thinkingBudget === undefined) {
      return undefined; // Don't set reasoning param, use model default
    }
    if (thinkingBudget === 0) {
      return "none";
    }
    if (thinkingBudget <= 2000) {
      return "low";
    }
    if (thinkingBudget <= 4000) {
      return "medium";
    }
    if (thinkingBudget <= 8000) {
      return "high";
    }
    return "xhigh";
  }

  protected transformResponse(response: ChatCompletion): LLMResponse {
    return {
      content: response.choices[0]?.message?.content || "",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      finishReason: response.choices[0]?.finish_reason ?? undefined,
    };
  }

  private buildResponsesInput(
    request: LLMRequest,
  ): ResponsesCreateParams["input"] {
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
        type: "message" as const,
      }));

    if (messages.length === 0) {
      return "";
    }

    return messages;
  }

  private mapToolsForChat(tools?: LLMTool[]): ChatCompletionTool[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools
      .map((tool) => this.mapToolToOpenAIChat(tool))
      .filter((tool): tool is ChatCompletionTool => tool !== null);
  }

  private buildWebSearchTools(tools?: LLMTool[]): OpenAITool[] {
    const mappedTools = Array.isArray(tools)
      ? tools
          .map((tool) => this.mapToolToOpenAIResponses(tool))
          .filter((tool): tool is OpenAITool => tool !== null)
      : [];

    // @ts-ignore
    if (!mappedTools.some((tool) => tool.type === "web_search")) {
      // @ts-ignore
      mappedTools.push({ type: "web_search" } as OpenAITool);
    }

    return mappedTools;
  }

  private mapToolToOpenAIChat(tool: LLMTool): ChatCompletionTool | null {
    switch (tool.type) {
      case "webSearch":
        return null; // unsupported in chat completions
      default:
        return null;
    }
  }

  private mapToolToOpenAIResponses(tool: LLMTool): OpenAITool | null {
    switch (tool.type) {
      case "webSearch":
        // @ts-ignore
        return { type: "web_search" } as OpenAITool;
      default:
        return null;
    }
  }

  private getWebSearchInclude(): ResponsesCreateParams["include"] {
    return [
      "web_search_call.action.sources",
    ] as unknown as ResponsesCreateParams["include"];
  }

  private transformWebSearchResponse(response: OpenAIResponse): {
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults: WebSearchResult[];
  } {
    const { llmOutput, citations } = this.extractOutputText(response);
    const cleanedLLMOutput = this.removeCitations(llmOutput, citations);
    const webSearchResults = this.buildWebSearchResults(response, citations);

    return {
      cleanedLLMOutput,
      llmOutput,
      webSearchResults,
    };
  }

  private extractOutputText(response: OpenAIResponse): {
    llmOutput: string;
    citations: Array<
      ResponseOutputText.URLCitation & {
        globalStart: number;
        globalEnd: number;
      }
    >;
  } {
    const messages = (response.output ?? []).filter(
      (item): item is ResponseOutputMessage => item.type === "message",
    );

    const citations: Array<
      ResponseOutputText.URLCitation & {
        globalStart: number;
        globalEnd: number;
      }
    > = [];
    let llmOutput = "";
    let offset = 0;

    messages.forEach((message) => {
      message.content
        .filter(
          (part): part is ResponseOutputText => part.type === "output_text",
        )
        .forEach((part) => {
          const textSegment = part.text ?? "";
          llmOutput += textSegment;

          (part.annotations ?? [])
            .filter(
              (annotation): annotation is ResponseOutputText.URLCitation =>
                annotation.type === "url_citation",
            )
            .forEach((annotation) => {
              citations.push({
                ...annotation,
                globalStart: offset + annotation.start_index,
                globalEnd: offset + annotation.end_index,
              });
            });

          offset += textSegment.length;
        });
    });

    return { llmOutput, citations };
  }

  private removeCitations(
    text: string,
    citations: Array<{ globalStart: number; globalEnd: number }>,
  ): string {
    if (!citations.length) return text;

    const sorted = [...citations].sort((a, b) => b.globalStart - a.globalStart);
    let cleaned = text;

    sorted.forEach(({ globalStart, globalEnd }) => {
      if (
        Number.isInteger(globalStart) &&
        Number.isInteger(globalEnd) &&
        globalStart >= 0 &&
        globalEnd < cleaned.length &&
        globalEnd >= globalStart
      ) {
        cleaned = cleaned.slice(0, globalStart) + cleaned.slice(globalEnd + 1);
      }
    });

    return cleaned;
  }

  private buildWebSearchResults(
    response: OpenAIResponse,
    citations: Array<ResponseOutputText.URLCitation & { globalStart: number }>,
  ): WebSearchResult[] {
    const sourcesMap = this.extractSources(response);
    const orderedCitations = [...citations].sort(
      (a, b) => a.globalStart - b.globalStart,
    );
    const results: WebSearchResult[] = [];
    const seenUrls = new Set<string>();
    let index = 0;

    orderedCitations.forEach((citation) => {
      const url = citation.url;
      if (!url || seenUrls.has(url)) return;

      const normalizedUrl = this.normalizeUrl(url);
      const source = sourcesMap.get(url) ?? sourcesMap.get(normalizedUrl);

      results.push({
        title: source?.title ?? citation.title ?? "",
        url: source?.url ?? url,
        originalUrl: source?.originalUrl ?? url,
        index: index++,
      });

      seenUrls.add(url);
      if (normalizedUrl !== url) {
        seenUrls.add(normalizedUrl);
      }
    });

    if (results.length) {
      return results;
    }

    const fallbackSources = Array.from(
      new Map(
        Array.from(sourcesMap.values()).map((source) => [source.url, source]),
      ).values(),
    );

    return fallbackSources.map((source, fallbackIndex) => ({
      title: source.title ?? "",
      url: source.url,
      originalUrl: source.originalUrl,
      index: fallbackIndex,
    }));
  }

  private extractSources(
    response: OpenAIResponse,
  ): Map<string, { title?: string; url: string; originalUrl: string }> {
    const map = new Map<
      string,
      { title?: string; url: string; originalUrl: string }
    >();

    (response.output ?? []).forEach((item) => {
      if (item.type !== "web_search_call") return;

      const action = (
        item as unknown as { action?: { sources?: unknown }; sources?: unknown }
      ).action;
      const rawSources = (action?.sources ??
        (item as unknown as { sources?: unknown }).sources) as unknown;

      if (!Array.isArray(rawSources)) return;

      rawSources.forEach((rawSource) => {
        if (typeof rawSource !== "object" || rawSource === null) return;

        const source = rawSource as {
          title?: unknown;
          url?: unknown;
          original_url?: unknown;
        };

        if (typeof source.url !== "string" || !source.url) return;

        const normalizedUrl = this.normalizeUrl(source.url);
        const originalUrl =
          typeof source.original_url === "string" && source.original_url
            ? source.original_url
            : source.url;
        const entry = {
          title: typeof source.title === "string" ? source.title : undefined,
          url: source.url,
          originalUrl,
        };

        map.set(source.url, entry);
        map.set(normalizedUrl, entry);
        if (originalUrl !== source.url) {
          map.set(originalUrl, entry);
          map.set(this.normalizeUrl(originalUrl), entry);
        }
      });
    });

    return map;
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.searchParams.sort();
      const pathname =
        parsed.pathname.endsWith("/") && parsed.pathname.length > 1
          ? parsed.pathname.slice(0, -1)
          : parsed.pathname;
      parsed.pathname = pathname;
      return parsed.toString();
    } catch {
      return url.trim();
    }
  }

  private async createStructuredCompletion(
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const input = this.buildResponsesInput(request);

    try {
      const response = await this.client.responses.parse({
        model: request.model,
        input,
        instructions: request.systemInstruction ?? undefined,
        text: {
          format: request.format,
        },
        max_output_tokens: request.maxTokens ?? undefined,
      } as any);

      return {
        content: JSON.stringify(response.output_parsed),
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens:
                response.usage.input_tokens + response.usage.output_tokens,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `OpenAI structured completion failed: ${error.message}`,
        );
      }
      throw error;
    }
  }
}
