import { zodTextFormat } from "openai/helpers/zod";
import character from "../../character";
import { LLM } from "../../llm/provider";
import type { LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import {
  hypGenDeepResearchPrompt,
  hypGenPrompt,
  hypGenWebPrompt,
} from "./prompts";
import type { THypothesisZod } from "./types";
import { HypothesisZodSchema } from "./types";

export type DocumentBlock = {
  type: "document";
  source: { type: "text"; media_type: "text/plain"; data: string };
  title: string;
  context: string;
  citations: { enabled: boolean };
};

export const makeDoc = (
  title: string,
  data: string,
  context: string,
): DocumentBlock => ({
  type: "document",
  source: { type: "text", media_type: "text/plain", data },
  title,
  context,
  citations: { enabled: true },
});

export type HypothesisDoc = { title: string; text: string; context: string };

export type HypothesisOptions = {
  model?: string;
  maxTokens?: number;
  stream?: boolean;
  thinking?: boolean;
  thinkingBudget?: number;
  useWebSearch?: boolean;
  isDeepResearch?: boolean;
  noveltyImprovement?: string;
  onStreamChunk?: (chunk: string, fullText: string) => Promise<void>;
};

export type WebSearchResults = {
  title?: string;
  url?: string;
  originalUrl?: string;
  index?: number;
};

export type HypothesisResult = {
  text: string;
  raw?: unknown;
  thought?: string;
  webSearchResults: WebSearchResults[];
};

export async function generateHypothesis(
  question: string,
  documents: HypothesisDoc[],
  options: HypothesisOptions = {},
): Promise<HypothesisResult> {
  const model = process.env.HYP_LLM_MODEL || "gemini-2.5-pro";
  const useWebSearch = options.useWebSearch;
  const isDeepResearch = options.isDeepResearch;
  const noveltyImprovement = options.noveltyImprovement;

  // Build document content
  const documentText = documents
    .map((d) => `Title: ${d.title}\n\n${d.text}`)
    .join("\n\n\n");

  // Select prompt based on mode
  let hypGenInstruction: string;
  if (isDeepResearch) {
    hypGenInstruction = hypGenDeepResearchPrompt.replace(
      "{{question}}",
      question,
    );

    // Append novelty improvement guidelines if available
    if (noveltyImprovement) {
      hypGenInstruction += `\n\nTo make sure the hypothesis is novel, follow these guidelines: ${noveltyImprovement}`;
    }
  } else if (useWebSearch) {
    hypGenInstruction = hypGenWebPrompt.replace("{{question}}", question);
  } else {
    hypGenInstruction = hypGenPrompt.replace("{{question}}", question);
  }

  const HYP_LLM_PROVIDER: LLMProvider =
    (process.env.HYP_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${HYP_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${HYP_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: HYP_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest = {
    model,
    messages: [
      {
        role: "assistant" as const,
        content: useWebSearch
          ? "Use web search to formulate a hypothesis."
          : `Use the following evidence set to formulate a hypothesis: ${documentText}`,
      },
      {
        role: "user" as const,
        content: hypGenInstruction,
      },
    ],
    maxTokens: options.maxTokens ?? 2048,
    thinkingBudget: options.thinking
      ? (options.thinkingBudget ?? 1024)
      : undefined,
    tools: useWebSearch ? [{ type: "webSearch" as const }] : undefined,
    stream: options.stream ?? false,
    onStreamChunk: options.onStreamChunk,
  };

  try {
    if (useWebSearch) {
      const response =
        await llmProvider.createChatCompletionWebSearch(llmRequest);

      let finalText = response.cleanedLLMOutput || response.llmOutput;
      const webSearchResults = response.webSearchResults ?? [];

      // Append sources if available
      // if (webSearchResults.length > 0) {
      //   const sourcesHeader = "\n\nAdditional sources:";
      //   const sourcesList = webSearchResults
      //     .map((result) => result.url)
      //     .join("\n");
      //   finalText += `${sourcesHeader}\n${sourcesList}`;
      // }

      return {
        text: finalText,
        raw: response,
        webSearchResults,
      };
    } else {
      const response = await llmProvider.createChatCompletion(llmRequest);

      // Parse JSON if needed
      let finalText = response.content;
      try {
        finalText = JSON.parse(
          response.content.replace(/```json\n?/, "").replace(/\n?```$/, ""),
        ).message;
      } catch {
        // Keep raw text if not JSON
      }

      return {
        text: finalText,
        raw: response,
        webSearchResults: [],
      };
    }
  } catch (error) {
    logger.error("Hypothesis generation failed:", error as any);
    throw error;
  }
}

export async function generateFinalResponse(
  prompt: string,
  webSearchResults?: WebSearchResults[],
  onStreamChunk?: (chunk: string, fullText: string) => Promise<void>,
) {
  const FINAL_LLM_PROVIDER: LLMProvider =
    (process.env.REPLY_LLM_PROVIDER as LLMProvider) || "google";
  const llmApiKey = process.env[`${FINAL_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${FINAL_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: FINAL_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest = {
    model: process.env.REPLY_LLM_MODEL || "gemini-2.5-pro",
    systemInstruction: character.system,
    messages: [
      {
        role: "user" as const,
        content: prompt,
      },
    ],
    maxTokens: 5000,
    thinkingBudget: 1024,
    stream: !!onStreamChunk,
    onStreamChunk,
  };

  const response = await llmProvider.createChatCompletion(llmRequest);

  // Parse JSON from response
  let finalText = "";
  try {
    finalText = JSON.parse(
      response.content.replace(/```json\n?/, "").replace(/\n?```$/, ""),
    ).message;
  } catch (error) {
    logger.warn("Failed to parse response as JSON, using raw text");
    finalText = response.content;
  }

  return {
    finalText,
    thought: undefined,
    webSearchResults: webSearchResults ?? [],
  };
}

export async function structured(
  prompt: string,
): Promise<THypothesisZod | null> {
  const developerPrompt = [
    "You are a strict JSON transformer.",
    'Return a JSON object that VALIDATES against the provided Zod schema named "output_zod_schema".',
    "Output ONLY the JSON — no prose, no markdown, no backticks.",
    "",
    "Constraints:",
    "- Do not add extra properties.",
    "- No citations or DOIs beyond those present in the input.",
    "- Keep text plain (no markdown).",
  ].join("\n");

  const STRUCTURED_LLM_PROVIDER: LLMProvider =
    (process.env.STRUCTURED_LLM_PROVIDER as LLMProvider) || "openai";
  const llmApiKey =
    process.env[`${STRUCTURED_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${STRUCTURED_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    name: STRUCTURED_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  const llmRequest = {
    model: process.env.STRUCTURED_LLM_MODEL || "gpt-5",
    systemInstruction: developerPrompt,
    messages: [
      {
        role: "user" as const,
        content: prompt,
      },
    ],
    format: zodTextFormat(HypothesisZodSchema, "output_zod_schema"),
  };

  const response = await llmProvider.createChatCompletion(llmRequest);

  try {
    return JSON.parse(response.content) as THypothesisZod;
  } catch (error) {
    logger.error("Failed to parse structured response:", error as any);
    return null;
  }
}
