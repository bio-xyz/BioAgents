import {
  GoogleGenAI,
  setDefaultBaseUrls,
  type GenerateContentResponse,
  type Content,
  type GroundingMetadata,
  type GroundingSupport,
  type GroundingChunk,
  type Tool as GoogleTool,
} from '@google/genai';

import { LLMAdapter } from '../adapter';
import type { LLMProvider, LLMRequest, LLMResponse, LLMTool, WebSearchResult } from '../types';
import { hasUrlInMessages, enrichMessagesWithUrlContent } from './utils';

type GoogleContent = Content;

interface BuildConfigOptions {
  includeWebSearch?: boolean;
}

export class GoogleAdapter extends LLMAdapter {
  private client: GoogleGenAI;

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error('Google provider requires an API key');
    }

    if (provider.baseUrl) {
      setDefaultBaseUrls({ geminiUrl: provider.baseUrl });
    }

    this.client = new GoogleGenAI({ apiKey: provider.apiKey });
  }

  async createChatCompletion(request: LLMRequest): Promise<LLMResponse> {
    const enrichedRequest = await this.enrichRequestIfNeeded(request);
    const parameters = this.transformRequest(enrichedRequest);

    try {
      const response = await this.client.models.generateContent(parameters);
      return this.transformResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Google chat completion failed: ${error.message}`);
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
    const parameters = this.transformRequest(enrichedRequest, { includeWebSearch: true });

    try {
      const response = await this.client.models.generateContent(parameters);
      return this.transformWebSearchResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Google web search failed: ${error.message}`);
      }
      throw error;
    }
  }

  private async enrichRequestIfNeeded(
    request: LLMRequest,
    _forceWebSearch = false
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
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
    };
  }

  protected transformRequest(
    request: LLMRequest,
    options: BuildConfigOptions = {}
  ): {
    model: string;
    contents: GoogleContent[];
    config?: Record<string, unknown>;
  } {
    const messages = this.buildContents(request);
    if (messages.length === 0) {
      throw new Error('Google adapter requires at least one non-system message');
    }

    const config: Record<string, unknown> = {};

    const systemSegments: string[] = [];
    if (request.systemInstruction) {
      systemSegments.push(request.systemInstruction);
    }

    request.messages
      .filter((message) => message.role === 'system')
      .forEach((message) => {
        if (message.content) {
          systemSegments.push(message.content);
        }
      });

    if (systemSegments.length > 0) {
      config.systemInstruction = systemSegments.join('\n\n');
    }

    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      const existingGenerationConfig =
        (config.generationConfig as Record<string, unknown> | undefined) ?? {};
      config.generationConfig = {
        ...existingGenerationConfig,
        maxOutputTokens: request.maxTokens,
      };
    }

    if (request.thinkingBudget !== undefined) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: request.thinkingBudget,
      };
    }

    const tools = this.mapTools(request.tools);

    if (options.includeWebSearch) {
      const hasGoogleSearchTool = tools.some((tool) => 'googleSearch' in tool);
      if (!hasGoogleSearchTool) {
        tools.push({ googleSearch: {} });
      }
    }

    if (tools.length > 0) {
      config.tools = tools as GoogleTool[];
    }

    return {
      model: request.model,
      contents: messages,
      config: Object.keys(config).length > 0 ? config : undefined,
    };
  }

  private buildContents(request: LLMRequest): GoogleContent[] {
    return request.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const role = message.role === 'assistant' ? 'model' : 'user';
        return {
          role,
          parts: [{ text: message.content }],
        } as GoogleContent;
      });
  }

  protected transformResponse(response: GenerateContentResponse): LLMResponse {
    const text = (response.text ?? '').trim();
    const usage = response.usageMetadata;

    return {
      content: text,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          }
        : undefined,
    };
  }

  private async transformWebSearchResponse(response: GenerateContentResponse): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults: WebSearchResult[];
  }> {
    const candidate = response.candidates?.[0];
    const baseText = (response.text ?? '').trim();
    const groundingMetadata = candidate?.groundingMetadata;

    const { textWithCitations, citedChunkIndices } = this.applyGroundingCitations(
      baseText,
      groundingMetadata
    );

    const webSearchResults = await this.collectWebResults(groundingMetadata, citedChunkIndices);
    const cleanedLLMOutput = textWithCitations
      .replace(/(?:,\s*)?\[(?:\d+(?:,\s*\d+)*)\]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return {
      cleanedLLMOutput,
      llmOutput: textWithCitations.trim(),
      webSearchResults,
    };
  }

  private applyGroundingCitations(
    text: string,
    groundingMetadata: GroundingMetadata | undefined
  ): { textWithCitations: string; citedChunkIndices: number[] } {
    if (
      !text ||
      !groundingMetadata?.groundingSupports?.length ||
      !groundingMetadata.groundingChunks
    ) {
      return { textWithCitations: text, citedChunkIndices: [] };
    }

    const supports = [...groundingMetadata.groundingSupports] as GroundingSupport[];
    const chunks = groundingMetadata.groundingChunks as GroundingChunk[];

    const citedChunks = new Set<number>();
    let updatedText = text;

    supports
      .slice()
      .sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0))
      .forEach((support) => {
        const endIndex = support.segment?.endIndex;
        if (typeof endIndex !== 'number' || !support.groundingChunkIndices?.length) {
          return;
        }

        const citations = support.groundingChunkIndices
          .map((index) => {
            const chunk = chunks[index];
            if (chunk?.web?.uri) {
              citedChunks.add(index);
              return `[${index + 1}]`;
            }
            return null;
          })
          .filter((value): value is string => Boolean(value));

        if (citations.length > 0) {
          const citationString = citations.join(', ');
          updatedText =
            updatedText.slice(0, endIndex) + citationString + updatedText.slice(endIndex);
        }
      });

    return { textWithCitations: updatedText, citedChunkIndices: Array.from(citedChunks) };
  }

  private async collectWebResults(
    groundingMetadata: GroundingMetadata | undefined,
    citedChunkIndices: number[]
  ): Promise<WebSearchResult[]> {
    if (
      !groundingMetadata?.groundingChunks?.length ||
      !Array.isArray(citedChunkIndices) ||
      citedChunkIndices.length === 0
    ) {
      return [];
    }

    const chunks = groundingMetadata.groundingChunks as GroundingChunk[];
    const orderedIndices = [...new Set(citedChunkIndices)].sort((a, b) => a - b);
    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    await Promise.all(
      orderedIndices.map(async (chunkIndex) => {
        const chunk = chunks[chunkIndex];
        const url = chunk?.web?.uri;
        if (!chunk?.web || !url || seen.has(url)) {
          return;
        }

        seen.add(url);

        // Resolve redirect URLs (Google grounding API returns redirect URLs)
        const resolvedUrl = await this.resolveRedirectUrl(url);

        results.push({
          title: chunk.web.title ?? '',
          url: resolvedUrl,
          originalUrl: url,
          index: chunkIndex + 1,
        });
      })
    );

    return results;
  }

  private async resolveRedirectUrl(redirectUrl: string): Promise<string> {
    try {
      const response = await fetch(redirectUrl, {
        method: 'HEAD',
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          return location;
        }
      }

      return redirectUrl;
    } catch (error) {
      console.error('Error resolving redirect URL:', error);
      return redirectUrl;
    }
  }

  private mapTools(tools: LLMTool[] | undefined): Array<Record<string, unknown>> {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools
      .map((tool) => this.mapToolToGoogle(tool))
      .filter((tool): tool is Record<string, unknown> => tool !== null);
  }

  private mapToolToGoogle(tool: LLMTool): Record<string, unknown> | null {
    switch (tool.type) {
      case 'webSearch':
        return { googleSearch: {} };
      default:
        return null;
    }
  }
}
