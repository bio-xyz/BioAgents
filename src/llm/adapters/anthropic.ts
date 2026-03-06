import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  TextBlock,
  ToolChoice,
  WebSearchResultBlock,
  WebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { LLMAdapter } from "../adapter";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMTool,
  WebSearchResult,
} from "../types";
import { enrichMessagesWithUrlContent, hasUrlInMessages } from "./utils";

interface BuildRequestOptions {
  includeWebSearch?: boolean;
}

export class AnthropicAdapter extends LLMAdapter {
  private client: Anthropic;

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error("Anthropic provider requires an API key");
    }

    const clientOptions: ConstructorParameters<typeof Anthropic>[0] = {
      apiKey: provider.apiKey,
      timeout: 240000,
    };

    if (provider.baseUrl) {
      clientOptions.baseURL = provider.baseUrl;
    }

    this.client = new Anthropic(clientOptions);
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const enrichedRequest = await this.enrichRequestIfNeeded(request);
    const anthropicRequest = this.transformRequest(enrichedRequest);

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingCompletion(
        anthropicRequest,
        request.onStreamChunk,
      );
    }

    try {
      const response = await this.client.messages.create(anthropicRequest);
      return this.transformResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Anthropic chat completion failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async createStreamingCompletion(
    anthropicRequest: MessageCreateParamsNonStreaming,
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<LLMResponse> {
    try {
      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;

      const stream = this.client.messages.stream(anthropicRequest);

      stream.on("text", async (text) => {
        fullText += text;
        await onStreamChunk(text, fullText);
      });

      // Wait for stream to complete and get final message
      const finalMessage = await stream.finalMessage();

      if (finalMessage.usage) {
        promptTokens = finalMessage.usage.input_tokens;
        completionTokens = finalMessage.usage.output_tokens;
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
        throw new Error(
          `Anthropic streaming completion failed: ${error.message}`,
        );
      }
      throw error;
    }
  }

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    // Always enrich for web search requests
    const enrichedRequest = await this.enrichRequestIfNeeded(request);
    const anthropicRequest = this.buildRequest(enrichedRequest, {
      includeWebSearch: true,
    });

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingWebSearch(
        anthropicRequest,
        request.onStreamChunk,
      );
    }

    try {
      const response = await this.client.messages.create(anthropicRequest);
      return this.transformWebSearchResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Anthropic web search failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async createStreamingWebSearch(
    anthropicRequest: MessageCreateParamsNonStreaming,
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    try {
      let fullText = "";

      const stream = this.client.messages.stream(anthropicRequest);

      stream.on("text", async (text) => {
        fullText += text;
        await onStreamChunk(text, fullText);
      });

      // Wait for stream to complete and get final message
      const finalMessage = await stream.finalMessage();

      // Transform the final message to extract web search results
      const result = this.transformWebSearchResponse(finalMessage);

      return {
        ...result,
        llmOutput: fullText,
        cleanedLLMOutput: result.cleanedLLMOutput || fullText,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Anthropic streaming web search failed: ${error.message}`,
        );
      }
      throw error;
    }
  }

  protected transformRequest(
    request: LLMRequest,
  ): MessageCreateParamsNonStreaming {
    return this.buildRequest(request);
  }

  protected transformResponse(response: Message): LLMResponse {
    const textContent = this.extractTextBlocks(response);
    const content = textContent.join("\n\n");

    return {
      content,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens:
              response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  private async enrichRequestIfNeeded(
    request: LLMRequest,
    _forceWebSearch = false,
  ): Promise<LLMRequest> {
    // Build temporary messages to check for URLs
    const tempMessages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const hasUrl = hasUrlInMessages(tempMessages);

    if (!hasUrl) {
      return request;
    }

    // Enrich messages with URL content
    const enrichedMessages = await enrichMessagesWithUrlContent(tempMessages);

    // Create new request with enriched messages
    return {
      ...request,
      messages: enrichedMessages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
    };
  }

  private buildRequest(
    request: LLMRequest,
    options: BuildRequestOptions = {},
  ): MessageCreateParamsNonStreaming {
    const { includeWebSearch = false } = options;

    const userAndAssistantMessages = request.messages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    );

    if (userAndAssistantMessages.length === 0) {
      throw new Error(
        "Anthropic requires at least one user or assistant message in the request",
      );
    }

    const systemSegments: string[] = [];
    if (request.systemInstruction) {
      systemSegments.push(request.systemInstruction);
    }

    request.messages
      .filter((message) => message.role === "system")
      .forEach((message) => {
        if (message.content) {
          systemSegments.push(message.content);
        }
      });

    // Anthropic requires max_tokens > thinking.budget_tokens
    // We handle this by adding thinkingBudget to maxTokens so developers can think of them as separate budgets
    const baseMaxTokens = request.maxTokens ?? 5000;
    const effectiveMaxTokens = request.thinkingBudget
      ? baseMaxTokens + request.thinkingBudget
      : baseMaxTokens;

    const anthropicRequest: MessageCreateParamsNonStreaming = {
      model: request.model,
      messages: userAndAssistantMessages.map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
      max_tokens: effectiveMaxTokens,
    };

    if (systemSegments.length > 0) {
      anthropicRequest.system = systemSegments.join("\n\n");
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    } else {
      anthropicRequest.temperature = 1;
    }

    if (request.thinkingBudget !== undefined) {
      anthropicRequest.thinking = {
        type: "enabled",
        budget_tokens: request.thinkingBudget,
      };
    }

    const mappedTools = this.mapTools(request.tools);
    if (mappedTools.length > 0) {
      anthropicRequest.tools = mappedTools;
    }

    if (includeWebSearch) {
      anthropicRequest.tools = this.ensureWebSearchTool(anthropicRequest.tools);
      anthropicRequest.tool_choice = this.ensureToolChoice(
        anthropicRequest.tool_choice,
      );
    }

    return anthropicRequest;
  }

  private mapTools(
    tools: LLMTool[] | undefined,
  ): NonNullable<MessageCreateParamsNonStreaming["tools"]> {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools
      .map((tool) => this.mapToolToAnthropic(tool))
      .filter(
        (
          tool,
        ): tool is NonNullable<
          MessageCreateParamsNonStreaming["tools"]
        >[number] => tool !== null,
      );
  }

  private mapToolToAnthropic(
    tool: LLMTool,
  ): NonNullable<MessageCreateParamsNonStreaming["tools"]>[number] | null {
    switch (tool.type) {
      case "webSearch":
        return {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        };
      default:
        return null;
    }
  }

  private ensureWebSearchTool(
    tools?: MessageCreateParamsNonStreaming["tools"],
  ): MessageCreateParamsNonStreaming["tools"] {
    const updatedTools = tools ? [...tools] : [];
    const hasWebSearchTool = updatedTools.some((tool) => {
      if (typeof tool !== "object" || tool === null) {
        return false;
      }

      const type = (tool as { type?: unknown }).type;
      return typeof type === "string" && type.startsWith("web_search");
    });

    if (!hasWebSearchTool) {
      updatedTools.push({
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      });
    }

    return updatedTools;
  }

  private ensureToolChoice(existingChoice?: ToolChoice): ToolChoice {
    if (existingChoice) {
      return existingChoice;
    }

    return { type: "auto" };
  }

  private transformWebSearchResponse(response: Message): {
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults: WebSearchResult[];
  } {
    const textBlocks = this.extractTextBlocks(response);
    const llmOutput = textBlocks.join("\n\n");

    let cleanedLLMOutput = llmOutput;
    const citationIndices = new Set<number>();

    cleanedLLMOutput = cleanedLLMOutput.replace(
      /<cite index="([^"]+)">([^<]+)<\/cite>/g,
      (_match, indexAttribute: string, innerText: string) => {
        const indices = indexAttribute.split(",");
        indices.forEach((entry) => {
          const [leading] = entry.split("-");
          const numericIndex = Number.parseInt(leading!, 10);
          if (!Number.isNaN(numericIndex)) {
            citationIndices.add(numericIndex - 1);
          }
        });

        return innerText;
      },
    );

    const webSearchBlock = response.content.find(
      (block): block is WebSearchToolResultBlock =>
        block.type === "web_search_tool_result",
    );

    let rawResults: WebSearchResultBlock[] = [];
    if (webSearchBlock && Array.isArray(webSearchBlock.content)) {
      rawResults = webSearchBlock.content as WebSearchResultBlock[];
    }

    const webSearchResults = this.buildWebSearchResults(
      rawResults,
      citationIndices,
    );

    return {
      cleanedLLMOutput: cleanedLLMOutput.trim(),
      llmOutput: llmOutput.trim(),
      webSearchResults,
    };
  }

  private extractTextBlocks(response: Message): string[] {
    return response.content
      .filter((block): block is TextBlock => block.type === "text")
      .map((block) => block.text.trim())
      .filter((text) => text.length > 0);
  }

  private buildWebSearchResults(
    results: WebSearchResultBlock[],
    citationIndices: Set<number>,
  ): WebSearchResult[] {
    const deduped = new Map<string, WebSearchResult>();

    const indicesToUse = citationIndices.size
      ? Array.from(citationIndices)
          .filter((index) => index >= 0 && index < results.length)
          .sort((a, b) => a - b)
      : results.map((_, index) => index);

    indicesToUse.forEach((index, order) => {
      const result = results[index];
      if (!result) {
        return;
      }

      const normalized = this.normalizeUrl(result.url);
      if (deduped.has(normalized)) {
        return;
      }

      deduped.set(normalized, {
        title: result.title || "",
        url: result.url,
        originalUrl: result.url,
        index: order,
      });
    });

    return Array.from(deduped.values());
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.searchParams.sort();

      if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      return parsed.toString();
    } catch {
      return url.trim();
    }
  }
}
