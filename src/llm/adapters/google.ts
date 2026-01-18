import {
  GoogleGenAI,
  setDefaultBaseUrls,
  type GenerateContentResponse,
  type Content,
  type GroundingMetadata,
  type GroundingSupport,
  type GroundingChunk,
  type Tool as GoogleTool,
  type File as GeminiFile,
} from '@google/genai';

import { LLMAdapter } from '../adapter';
import type { LLMProvider, LLMRequest, LLMResponse, LLMTool, WebSearchResult } from '../types';
import { hasUrlInMessages, enrichMessagesWithUrlContent } from './utils';
import logger from '../../utils/logger';

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

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingCompletion(parameters, request.onStreamChunk);
    }

    try {
      const response = await this.client.models.generateContent(parameters);
      return this.transformResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({
        error: errorMessage,
        model: parameters.model,
        hasFiles: !!request.fileUris?.length
      }, 'Google chat completion failed');
      throw new Error(`Google chat completion failed: ${errorMessage}`);
    }
  }

  private async createStreamingCompletion(
    parameters: {
      model: string;
      contents: GoogleContent[];
      config?: Record<string, unknown>;
    },
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<LLMResponse> {
    try {
      const stream = await this.client.models.generateContentStream(parameters);

      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.text || "";
        if (delta) {
          fullText += delta;
          await onStreamChunk(delta, fullText);
        }

        // Capture usage if available
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          totalTokens = chunk.usageMetadata.totalTokenCount ?? 0;
        }
      }

      return {
        content: fullText,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Google streaming completion failed: ${errorMessage}`);
    }
  }

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    const enrichedRequest = await this.enrichRequestIfNeeded(request);
    const parameters = this.transformRequest(enrichedRequest, { includeWebSearch: true });

    // Handle streaming
    if (request.stream && request.onStreamChunk) {
      return this.createStreamingWebSearch(parameters, request.onStreamChunk);
    }

    try {
      const response = await this.client.models.generateContent(parameters);
      return this.transformWebSearchResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, model: parameters.model }, 'Google web search failed');
      throw new Error(`Google web search failed: ${errorMessage}`);
    }
  }

  private async createStreamingWebSearch(
    parameters: {
      model: string;
      contents: GoogleContent[];
      config?: Record<string, unknown>;
    },
    onStreamChunk: (chunk: string, fullText: string) => Promise<void>,
  ): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    try {
      const stream = await this.client.models.generateContentStream(parameters);

      let fullText = "";
      let finalResponse: GenerateContentResponse | null = null;

      for await (const chunk of stream) {
        const delta = chunk.text || "";
        if (delta) {
          fullText += delta;
          await onStreamChunk(delta, fullText);
        }

        // Keep track of the last chunk which contains grounding metadata
        finalResponse = chunk;
      }

      // Use the final response to extract web search results
      if (finalResponse) {
        const result = await this.transformWebSearchResponse(finalResponse);
        return {
          ...result,
          llmOutput: fullText,
          cleanedLLMOutput: result.cleanedLLMOutput || fullText,
        };
      }

      return {
        llmOutput: fullText,
        cleanedLLMOutput: fullText,
        webSearchResults: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Google streaming web search failed: ${errorMessage}`);
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

    return {
      ...request,
      messages: enrichedMessages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      fileUris: request.fileUris,
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

    // Google counts thinking tokens within maxOutputTokens (thoughts + output <= maxOutputTokens)
    // We handle this by adding thinkingBudget to maxTokens so developers can think of them as separate budgets
    if (request.maxTokens !== undefined || request.thinkingBudget !== undefined) {
      const baseMaxTokens = request.maxTokens ?? 5000;
      const effectiveMaxTokens = request.thinkingBudget
        ? baseMaxTokens + request.thinkingBudget
        : baseMaxTokens;

      const existingGenerationConfig =
        (config.generationConfig as Record<string, unknown> | undefined) ?? {};
      config.generationConfig = {
        ...existingGenerationConfig,
        maxOutputTokens: effectiveMaxTokens,
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
    const contents = request.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const role = message.role === 'assistant' ? 'model' : 'user';
        const parts = this.convertContentToParts(message.content);
        return {
          role,
          parts,
        } as GoogleContent;
      });

    // If file URIs are provided, add them to the last user message
    if (request.fileUris && request.fileUris.length > 0) {
      const lastUserMessageIndex = contents.map(c => c.role).lastIndexOf('user');
      if (lastUserMessageIndex >= 0) {
        const lastUserMessage = contents[lastUserMessageIndex];
        if (lastUserMessage && lastUserMessage.parts) {
          const fileParts = request.fileUris.map((fileInfo) => ({
            fileData: {
              fileUri: fileInfo.fileUri,
              mimeType: fileInfo.mimeType,
            },
          }));
          lastUserMessage.parts = [...lastUserMessage.parts, ...fileParts];
          logger.info(`Attached ${request.fileUris.length} file(s) to request`);
        }
      } else {
        logger.warn('No user message found to attach files to');
      }
    }

    return contents;
  }

  /**
   * Convert message content to Google's parts format.
   * Handles both string content and multimodal content arrays.
   *
   * Multimodal array format:
   * [
   *   { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
   *   { type: "text", text: "prompt text" }
   * ]
   *
   * Google format:
   * [
   *   { inlineData: { mimeType: "image/png", data: "..." } },
   *   { text: "prompt text" }
   * ]
   */
  private convertContentToParts(content: string | unknown): Array<Record<string, unknown>> {
    // If content is a simple string, return as text part
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    // If content is an array (multimodal format), convert each block
    if (Array.isArray(content)) {
      const parts: Array<Record<string, unknown>> = [];

      for (const block of content) {
        if (typeof block !== 'object' || block === null) {
          continue;
        }

        const typedBlock = block as Record<string, unknown>;

        // Handle text blocks
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          parts.push({ text: typedBlock.text });
        }
        // Handle image blocks with base64 source
        else if (typedBlock.type === 'image' && typedBlock.source) {
          const source = typedBlock.source as Record<string, unknown>;
          if (source.type === 'base64' && typeof source.data === 'string') {
            const mimeType = (source.media_type as string) || 'image/png';
            parts.push({
              inlineData: {
                mimeType,
                data: source.data,
              },
            });
            logger.info({ mimeType }, 'Converted image block to Google inlineData format');
          }
        }
        // Handle image_url blocks (data URL format)
        else if (typedBlock.type === 'image_url' && typedBlock.image_url) {
          const imageUrl = typedBlock.image_url as Record<string, unknown>;
          const url = imageUrl.url as string;

          // Check if it's a data URL (base64 inline)
          if (url?.startsWith('data:')) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
              logger.info({ mimeType: match[1] }, 'Converted data URL to Google inlineData format');
            }
          } else {
            logger.warn({ url: url?.substring(0, 100) }, 'Cannot convert external image URL to Google format - requires file upload');
          }
        }
      }

      // If we couldn't extract any parts, fall back to stringifying
      if (parts.length === 0) {
        logger.warn('No valid parts extracted from multimodal content, falling back to string');
        return [{ text: JSON.stringify(content) }];
      }

      return parts;
    }

    // Fallback: stringify unknown content
    logger.warn({ contentType: typeof content }, 'Unknown content type, converting to string');
    return [{ text: String(content) }];
  }

  protected transformResponse(response: GenerateContentResponse): LLMResponse {
    let text = (response.text ?? '').trim();
    const usage = response.usageMetadata;

    // Handle code execution parts
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      const hasCodeExecution = candidate.content.parts.some((part: any) =>
        part.executableCode || part.codeExecutionResult
      );
      if (hasCodeExecution) {
        const textParts: string[] = [];
        let codeExecutionOutput: string | undefined = undefined;

        candidate.content.parts.forEach((part: any) => {
          if (part.codeExecutionResult?.output) {
            codeExecutionOutput = part.codeExecutionResult.output;
          }
          if (part.text) {
            textParts.push(part.text);
          }
        });

        // Prefer the last text part if available, otherwise use code execution output
        if (textParts.length > 0) {
          const lastTextPart = textParts[textParts.length - 1];
          if (lastTextPart) {
            text = lastTextPart.trim();
          }
        } else if (codeExecutionOutput) {
          text = (codeExecutionOutput as string).trim();
        }
      }
    }

    return {
      content: text,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          }
        : undefined,
      finishReason: candidate?.finishReason ?? undefined,
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
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to resolve redirect URL');
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
      case 'codeExecution':
        return { codeExecution: {} };
      default:
        return null;
    }
  }

  /**
   * Uploads a file to Gemini File API for use in chat requests
   * @param fileBuffer - The file buffer to upload
   * @param fileName - The name of the file
   * @param mimeType - The MIME type of the file
   * @returns The uploaded file metadata including URI
   */
  async uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<GeminiFile> {
    try {
      logger.info(`Uploading file to Gemini: ${fileName}`);

      const uint8Array = new Uint8Array(fileBuffer);
      const blob = new Blob([uint8Array], { type: mimeType });

      const uploadedFile = await this.client.files.upload({
        file: blob,
        config: {
          displayName: fileName,
          mimeType: mimeType,
        },
      });

      // Wait for file to be in ACTIVE state (required before using in requests)
      if (uploadedFile.state === 'PROCESSING') {
        let retries = 0;
        const maxRetries = 10;

        while (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));

          if (!uploadedFile.name) {
            throw new Error('File name is missing from upload response');
          }

          const fileStatus = await this.client.files.get({ name: uploadedFile.name });

          if (fileStatus.state === 'ACTIVE') {
            logger.info(`File uploaded and ready: ${fileName}`);
            return fileStatus;
          } else if (fileStatus.state === 'FAILED') {
            throw new Error('File processing failed');
          }

          retries++;
        }

        throw new Error('File processing timeout - file did not become ACTIVE');
      }

      logger.info(`File uploaded successfully: ${fileName}`);
      return uploadedFile;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, fileName }, 'Failed to upload file to Gemini');
      throw new Error(`Failed to upload file to Gemini: ${errorMessage}`);
    }
  }
}
