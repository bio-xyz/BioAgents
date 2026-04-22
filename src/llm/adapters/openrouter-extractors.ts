import logger from "../../utils/logger";
import type { WebSearchResult } from "../types";

export interface OpenRouterAnnotation {
  type: string;
  url_citation?: {
    url: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

export interface OpenRouterMessage {
  role: string;
  content: string;
  annotations?: OpenRouterAnnotation[];
}

export interface OpenRouterResponse {
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

/**
 * Extract the first choice's text from an OpenRouter response.
 * Warns when choices are missing/empty so an error-like 200 is visible in logs.
 */
export function extractTextFromOpenRouterResponse(response: OpenRouterResponse): string {
  if (!response?.choices || response.choices.length === 0) {
    logger.warn({ hasUsage: !!response?.usage }, "openrouter_empty_choices");
    return "";
  }

  const choice = response.choices[0];
  if (!choice) return "";
  return choice.message?.content ?? choice.text ?? "";
}

/**
 * Extract URL-citation annotations from the first choice as WebSearchResults.
 * Deduplicates by URL. extractTextFromOpenRouterResponse already warns on the
 * empty-choices path, so this function stays silent there.
 */
export function extractWebSearchResultsFromOpenRouterResponse(
  response: OpenRouterResponse
): WebSearchResult[] {
  if (!response?.choices || response.choices.length === 0) {
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
