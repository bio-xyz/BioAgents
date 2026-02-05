/**
 * Clarification Agent Utilities
 *
 * LLM calls for generating clarification questions.
 */

import { LLM } from "../../llm/provider";
import type { ClarificationQuestion } from "../../types/clarification";
import type { LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import { GENERATE_QUESTIONS_PROMPT } from "./prompts";

export type DatasetInfo = {
  filename: string;
  description?: string;
};

export type GenerateQuestionsOptions = {
  model?: string;
  maxTokens?: number;
  datasets?: DatasetInfo[];
};

export type GenerateQuestionsResult = {
  questions: ClarificationQuestion[];
  reasoning: string;
};

/**
 * Generate clarification questions for a research query
 */
export async function generateQuestions(
  query: string,
  options: GenerateQuestionsOptions = {},
): Promise<GenerateQuestionsResult> {
  // Use planning LLM provider for clarification (same tier of reasoning needed)
  const CLARIFICATION_LLM_PROVIDER: LLMProvider =
    (process.env.CLARIFICATION_LLM_PROVIDER as LLMProvider) ||
    (process.env.PLANNING_LLM_PROVIDER as LLMProvider) ||
    "google";

  const llmApiKey =
    process.env[`${CLARIFICATION_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!llmApiKey) {
    throw new Error(
      `${CLARIFICATION_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const model =
    options.model ||
    process.env.CLARIFICATION_LLM_MODEL ||
    process.env.PLANNING_LLM_MODEL ||
    "gemini-2.5-pro";

  const llmProvider = new LLM({
    name: CLARIFICATION_LLM_PROVIDER,
    apiKey: llmApiKey,
  });

  // Build dataset context if provided
  let datasetContext = "";
  if (options.datasets && options.datasets.length > 0) {
    const datasetList = options.datasets
      .map((d) => `- ${d.filename}${d.description ? `: ${d.description}` : " (no description provided)"}`)
      .join("\n");

    const datasetsWithoutDescription = options.datasets.filter((d) => !d.description);
    const hasMultipleDatasets = options.datasets.length > 1;

    let dataGuidance = "Since the user has data, adjust data_requirements questions to focus on how they want to use this data rather than asking if they have data.";

    if (datasetsWithoutDescription.length > 0) {
      dataGuidance += `\n- Some datasets lack descriptions (${datasetsWithoutDescription.map((d) => d.filename).join(", ")}). Consider asking what these files contain.`;
    }

    if (hasMultipleDatasets) {
      dataGuidance += "\n- User has multiple datasets. Consider asking which dataset to use for which purpose, or how they relate to each other.";
    }

    datasetContext = `\n\nUSER'S AVAILABLE DATA\nThe user has the following data files available for analysis:\n${datasetList}\n\nNote: ${dataGuidance}`;
  }

  const prompt = GENERATE_QUESTIONS_PROMPT.replace("{query}", query + datasetContext);

  logger.info(
    { query: query.substring(0, 100), model, datasetCount: options.datasets?.length || 0 },
    "generating_clarification_questions",
  );

  try {
    const response = await llmProvider.createChatCompletion({
      model,
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      maxTokens: options.maxTokens ?? 1024,
      thinkingBudget: 1024,
    });

    // Parse JSON response
    const content = response.content.trim();
    let parsed: { questions: ClarificationQuestion[]; reasoning: string };

    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : content;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.error(
        { content, parseError },
        "failed_to_parse_questions_response",
      );
      // Return empty questions if parsing fails
      return {
        questions: [],
        reasoning: "Failed to parse LLM response",
      };
    }

    // Validate and filter questions
    const validQuestions = (parsed.questions || []).filter(
      (q) =>
        q.category &&
        q.question &&
        q.priority &&
        ["ambiguity", "data_requirements", "scope_constraints", "methodology"].includes(q.category) &&
        ["high", "medium", "low"].includes(q.priority),
    );

    logger.info(
      {
        questionCount: validQuestions.length,
        categories: validQuestions.map((q) => q.category),
      },
      "clarification_questions_generated",
    );

    return {
      questions: validQuestions,
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    logger.error({ error, query }, "generate_questions_failed");
    throw error;
  }
}
