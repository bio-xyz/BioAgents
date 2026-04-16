import { z } from "zod";
import logger from "../../utils/logger";
import { LLMAdapter } from "../adapter";
import type { LLMProvider, LLMRequest, LLMResponse, LLMTool, WebSearchResult } from "../types";

interface OpenRouterRequestPayload {
  model: string;
  input: Array<{ role: string; content: string }> | string;
  max_output_tokens?: number;
  temperature?: number;
  plugins?: OpenRouterPlugin[];
  reasoning?: {
    effort: "low" | "medium" | "high";
  };
}

interface OpenRouterPlugin {
  id: string;
  [key: string]: unknown;
}

const OpenRouterSearchResultSchema = z.object({
  original_url: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

const OpenRouterPluginResultsSchema = z.object({
  id: z.string().optional(),
  results: z.array(OpenRouterSearchResultSchema).optional(),
});

const OpenRouterResponseSchema = z.object({
  aggregated_output_text: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().optional() }).optional() }))
    .optional(),
  data: z
    .array(
      z.object({
        content: z.array(z.object({ text: z.string().optional() })).optional(),
      })
    )
    .optional(),
  metrics: z
    .object({
      tokens: z
        .object({
          input: z.number().optional(),
          output: z.number().optional(),
          total: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  output: z
    .array(
      z.object({
        content: z
          .array(
            z.object({
              annotations: z
                .array(
                  z.object({
                    end_index: z.number().optional(),
                    start_index: z.number().optional(),
                    title: z.string().optional(),
                    type: z.string().optional(),
                    url: z.string().optional(),
                  })
                )
                .optional(),
              text: z.string().optional(),
              type: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  output_text: z.string().optional(),
  plugins: z.array(OpenRouterPluginResultsSchema).optional(),
  response: z.object({ output_text: z.string().optional() }).optional(),
  traces: z
    .array(z.object({ plugins: z.array(OpenRouterPluginResultsSchema).optional() }))
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;

export class OpenRouterAdapter extends LLMAdapter {
  private readonly baseUrl: string;
  private readonly defaultReasoning?: "low" | "medium" | "high";

  constructor(provider: LLMProvider) {
    super(provider);

    if (!provider.apiKey) {
      throw new Error("OpenRouter provider requires an API key");
    }

    this.baseUrl = (provider.baseUrl ?? "https://openrouter.ai/api/alpha").replace(/\/$/, "");
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
      input:
        messages.length > 0
          ? messages
          : (request.messages[request.messages.length - 1]?.content ?? ""),
      model: request.model,
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
      messages.push({ content: request.systemInstruction, role: "system" });
    }

    request.messages.forEach((message) => {
      messages.push({ content: message.content, role: message.role });
    });

    return messages;
  }

  private ensureWebSearchTool(request: LLMRequest): LLMRequest {
    const existingTools = Array.isArray(request.tools) ? [...request.tools] : [];
    const hasWebSearch = existingTools.some((tool) => tool.type === "webSearch");

    if (hasWebSearch) {
      return request;
    }

    return {
      ...request,
      tools: [...existingTools, { type: "webSearch" }],
    };
  }

  private async executeRequest(payload: OpenRouterRequestPayload): Promise<OpenRouterResponse> {
    const url = `${this.baseUrl}/chat/completions`; // not /responses
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
      // Read body once
      const raw = await res.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      // Prefer structured error info when present
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

    const raw: unknown = await res.json();
    // Use safeParse: a hard .parse() would throw ZodError, which retry.ts's
    // FallbackError check doesn't catch — minor provider schema drift would
    // silently disable the fallback chain. Log and pass the raw response through;
    // downstream extractors already use optional chaining.
    const parsed = OpenRouterResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues, url }, "openrouter_response_schema_mismatch");
      return raw as OpenRouterResponse;
    }
    return parsed.data;
  }
  private extractText(response: OpenRouterResponse): string {
    if (!response) {
      return "";
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

    return fragments.join("\n").trim();
  }

  private collectTextFragments(value: unknown, fragments: string[]): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === "string") {
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

    if (typeof value === "object") {
      const maybeText = (value as { text?: unknown }).text;
      if (typeof maybeText === "string") {
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

  private extractUsage(response: OpenRouterResponse): LLMResponse["usage"] {
    const promptTokens = response.usage?.input_tokens ?? response.metrics?.tokens?.input ?? 0;
    const completionTokens = response.usage?.output_tokens ?? response.metrics?.tokens?.output ?? 0;
    const totalTokens =
      response.usage?.total_tokens ??
      response.metrics?.tokens?.total ??
      promptTokens + completionTokens;

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
    const cleanedLLMOutput = this.stripCitationSection(
      llmOutput
        .replace(/(?:,\s*)?\[(?:\d+(?:,\s*\d+)*)\]/g, "")
        .replace(/[ \t]{2,}/g, " ")
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
      .filter((plugin) => plugin?.id === "web")
      .forEach((plugin) => {
        const pluginResults = Array.isArray(plugin.results) ? plugin.results : [];
        pluginResults.forEach((result) => {
          const url = typeof result.url === "string" ? result.url : undefined;
          if (!url || seen.has(url)) {
            return;
          }

          seen.add(url);
          results.push({
            index: index++,
            originalUrl: typeof result.original_url === "string" ? result.original_url : url,
            title: typeof result.title === "string" ? result.title : "",
            url,
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
                annotation.type === "url_citation" && typeof annotation.url === "string"
            )
            .forEach((annotation) => {
              const url = annotation.url as string;
              if (seen.has(url)) {
                return;
              }
              seen.add(url);
              results.push({
                index: index++,
                originalUrl: url,
                title: typeof annotation.title === "string" ? annotation.title : "",
                url,
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
      case "webSearch":
        return { id: "web", max_results: 3 };
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
