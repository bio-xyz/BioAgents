import type { WebSearchResult } from "../llm/types";
import type { State } from "../types/core";
import logger from "./logger";

export function addVariablesToState(
  state: State,
  variables: Record<string, any>,
) {
  state.values = {
    ...state.values,
    ...variables,
  };
}

export function startStep(state: State, stepName: string) {
  if (!state.values.steps) {
    state.values.steps = {};
  }
  state.values.steps[stepName] = {
    start: Date.now(),
  };
}

export function endStep(state: State, stepName: string) {
  if (!state.values.steps) {
    state.values.steps = {};
  }
  if (!state.values.steps[stepName]) {
    state.values.steps[stepName] = {};
  }
  state.values.steps[stepName].end = Date.now();
}

export function cleanWebSearchResults(
  webSearchResults: WebSearchResult[],
): WebSearchResult[] {
  return webSearchResults.map((result) => {
    let cleanedTitle = result.title;

    // Check if title looks like a URL
    if (
      cleanedTitle.startsWith("http://") ||
      cleanedTitle.startsWith("https://") ||
      cleanedTitle.startsWith("www.")
    ) {
      try {
        // Parse the URL to extract just the domain
        const urlToParse = cleanedTitle.startsWith("www.")
          ? `https://${cleanedTitle}`
          : cleanedTitle;
        const parsedUrl = new URL(urlToParse);
        cleanedTitle = parsedUrl.hostname.replace(/^www\./, "www.");

        // Ensure it starts with www.
        if (!cleanedTitle.startsWith("www.")) {
          cleanedTitle = "www." + cleanedTitle;
        }
      } catch {
        // If parsing fails, keep the original title
      }
    }

    return {
      ...result,
      title: cleanedTitle,
    };
  });
}

/**
 * Format conversation history from DB messages
 * Each DB message contains both user question and assistant response
 * @param messages - Array of messages from the database
 * @returns Formatted conversation history string
 */
export function formatConversationHistory(messages: any[]): string {
  if (!messages || messages.length === 0) {
    return "";
  }

  return messages
    .flatMap((msg) => {
      const formattedMessages = [];
      if (msg.question) {
        formattedMessages.push(`User: ${msg.question}`);
      }
      if (msg.content) {
        formattedMessages.push(`Assistant: ${msg.content}`);
      }
      return formattedMessages;
    })
    .join("\n");
}

export function parseKeyValueXml(text: string): Record<string, any> | null {
  if (!text) return null;

  // First, try to find a specific <response> block (the one we actually want)
  // Use a more permissive regex to handle cases where there might be multiple XML blocks
  let xmlBlockMatch = text.match(/<response>([\s\S]*?)<\/response>/);
  let xmlContent: string;

  if (xmlBlockMatch) {
    xmlContent = xmlBlockMatch[1]!;
    logger.debug("Found response XML block");
  } else {
    // Fall back to finding any XML block (e.g., <response>...</response>)
    const fallbackMatch = text.match(/<(\w+)>([\s\S]*?)<\/\1>/);
    if (!fallbackMatch) {
      logger.warn("Could not find XML block in text");
      logger.debug(`Text content: ${text.substring(0, 200)}...`);
      return null;
    }
    xmlContent = fallbackMatch[2]!;
    logger.debug(`Found XML block with tag: ${fallbackMatch[1]}`);
  }

  const result: Record<string, any> = {};

  // Regex to find <key>value</key> patterns
  const tagPattern = /<([\w-]+)>([\s\S]*?)<\/([\w-]+)>/g;
  let match;

  while ((match = tagPattern.exec(xmlContent)) !== null) {
    // Ensure opening and closing tags match
    if (match[1] === match[3]) {
      const key = match[1]!;
      // Basic unescaping for common XML entities (add more as needed)
      const value = match[2]!
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

      // Handle potential comma-separated lists for specific keys
      if (key === "actions" || key === "providers" || key === "evaluators") {
        result[key] = value ? value.split(",").map((s) => s.trim()) : [];
      } else if (key === "simple") {
        result[key] = value.toLowerCase() === "true";
      } else {
        result[key] = value;
      }
    } else {
      logger.warn(
        `Mismatched XML tags found: <${match[1]}> and </${match[3]}>`,
      );
      // Potentially skip this mismatched pair or return null depending on strictness needed
    }
  }

  // Return null if no key-value pairs were found
  if (Object.keys(result).length === 0) {
    logger.warn("No key-value pairs extracted from XML content");
    logger.debug(`XML content was: ${xmlContent.substring(0, 200)}...`);
    return null;
  }

  return result;
}
