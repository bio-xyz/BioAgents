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

  async createChatCompletionWebSearch(request: LLMRequest): Promise<{
    cleanedLLMOutput: string;
    llmOutput: string;
    webSearchResults?: WebSearchResult[];
  }> {
    const enrichedRequest = await this.enrichRequestIfNeeded(request);
    const parameters = this.transformRequest(enrichedRequest, { includeWebSearch: true });

    try {
      const response = await this.client.models.generateContent(parameters);
      return this.transformWebSearchResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, model: parameters.model }, 'Google web search failed');
      throw new Error(`Google web search failed: ${errorMessage}`);
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

    if (request.maxTokens !== undefined) {
      const existingGenerationConfig =
        (config.generationConfig as Record<string, unknown> | undefined) ?? {};
      config.generationConfig = {
        ...existingGenerationConfig,
        maxOutputTokens: request.maxTokens,
      };
    }

    // Only include thinkingConfig for thinking models (gemini-2.0-flash-thinking-*)
    if (request.thinkingBudget !== undefined && request.model.includes('thinking')) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: request.thinkingBudget,
      };
    } else if (request.thinkingBudget !== undefined && !request.model.includes('thinking')) {
      logger.warn('thinkingBudget specified but model does not support thinking');
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
        return {
          role,
          parts: [{ text: message.content }],
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
