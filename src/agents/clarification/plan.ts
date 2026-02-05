/**
 * Clarification Plan Generation
 *
 * LLM calls for generating and regenerating research plans
 * based on clarification answers.
 */

import { LLM } from "../../llm/provider";
import type {
  ClarificationAnswer,
  ClarificationPlan,
  ClarificationQuestion,
} from "../../types/clarification";
import type { LLMProvider } from "../../types/core";
import logger from "../../utils/logger";
import { GENERATE_PLAN_PROMPT, REGENERATE_PLAN_PROMPT } from "./prompts";

export type DatasetInfo = {
  filename: string;
  description?: string;
};

export type GeneratePlanOptions = {
  model?: string;
  maxTokens?: number;
  datasets?: DatasetInfo[];
};

/**
 * Build questions and answers string for prompts
 */
function formatQuestionsAndAnswers(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
): string {
  const answerMap = new Map(answers.map((a) => [a.questionIndex, a.answer]));

  return questions
    .map((q, index) => {
      const answer = answerMap.get(index) || "(No answer provided)";
      return `Q${index + 1} [${q.category}]: ${q.question}\nA${index + 1}: ${answer}`;
    })
    .join("\n\n");
}

/**
 * Format available datasets for display in prompts
 */
function formatAvailableDatasets(datasets?: DatasetInfo[]): string {
  if (!datasets || datasets.length === 0) {
    return "No datasets available. Only LITERATURE tasks can be planned.";
  }
  return datasets
    .map((d) => `- ${d.filename}${d.description ? `: ${d.description}` : ""}`)
    .join("\n");
}

/**
 * Format a plan object for display in prompts
 */
function formatPlanForPrompt(plan: ClarificationPlan): string {
  const taskList = plan.initialTasks
    .map((t, i) => {
      const filenames =
        t.datasetFilenames.length > 0
          ? t.datasetFilenames.join(", ")
          : "None";
      return `  ${i + 1}. [${t.type}] ${t.objective}\n     Datasets: ${filenames}`;
    })
    .join("\n");

  return `Objective: ${plan.objective}
Initial Tasks:
${taskList}`;
}

/**
 * Generate a research plan from clarification answers
 */
export async function generatePlanFromContext(input: {
  query: string;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  datasets?: DatasetInfo[];
  options?: GeneratePlanOptions;
}): Promise<ClarificationPlan> {
  const { query, questions, answers, datasets, options = {} } = input;

  // Use planning LLM provider for plan generation
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

  const questionsAndAnswers = formatQuestionsAndAnswers(questions, answers);
  const availableDatasets = formatAvailableDatasets(datasets);

  const prompt = GENERATE_PLAN_PROMPT.replace("{query}", query)
    .replace("{questionsAndAnswers}", questionsAndAnswers)
    .replace("{availableDatasets}", availableDatasets);

  logger.info(
    { query: query.substring(0, 100), answerCount: answers.length, model },
    "generating_clarification_plan",
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
      maxTokens: options.maxTokens ?? 2048,
      thinkingBudget: 2048,
    });

    // Parse JSON response
    const content = response.content.trim();
    let parsed: ClarificationPlan;

    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : content;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.error({ content, parseError }, "failed_to_parse_plan_response");
      throw new Error("Failed to parse plan from LLM response");
    }

    // Validate required fields
    if (!parsed.objective) {
      throw new Error("Plan missing required field: objective");
    }

    // Ensure arrays have defaults
    const plan: ClarificationPlan = {
      objective: parsed.objective,
      initialTasks: parsed.initialTasks || [],
    };

    logger.info(
      {
        objective: plan.objective.substring(0, 100),
        taskCount: plan.initialTasks.length,
      },
      "clarification_plan_generated",
    );

    return plan;
  } catch (error) {
    logger.error({ error, query }, "generate_plan_failed");
    throw error;
  }
}

/**
 * Regenerate a research plan based on user feedback
 */
export async function regeneratePlanFromFeedback(input: {
  query: string;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  previousPlan: ClarificationPlan;
  feedback: string;
  datasets?: DatasetInfo[];
  options?: GeneratePlanOptions;
}): Promise<ClarificationPlan> {
  const { query, questions, answers, previousPlan, feedback, datasets, options = {} } =
    input;

  // Use planning LLM provider for plan generation
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

  const questionsAndAnswers = formatQuestionsAndAnswers(questions, answers);
  const availableDatasets = formatAvailableDatasets(datasets);
  const previousPlanStr = formatPlanForPrompt(previousPlan);

  const prompt = REGENERATE_PLAN_PROMPT.replace("{query}", query)
    .replace("{questionsAndAnswers}", questionsAndAnswers)
    .replace("{availableDatasets}", availableDatasets)
    .replace("{previousPlan}", previousPlanStr)
    .replace("{feedback}", feedback);

  logger.info(
    {
      query: query.substring(0, 100),
      feedback: feedback.substring(0, 100),
      model,
      datasetCount: datasets?.length ?? 0,
    },
    "regenerating_clarification_plan",
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
      maxTokens: options.maxTokens ?? 2048,
      thinkingBudget: 2048,
    });

    // Parse JSON response
    const content = response.content.trim();
    let parsed: ClarificationPlan;

    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : content;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.error(
        { content, parseError },
        "failed_to_parse_regenerated_plan_response",
      );
      throw new Error("Failed to parse regenerated plan from LLM response");
    }

    // Validate required fields
    if (!parsed.objective) {
      throw new Error("Regenerated plan missing required field: objective");
    }

    // Ensure arrays have defaults
    const plan: ClarificationPlan = {
      objective: parsed.objective,
      initialTasks: parsed.initialTasks || [],
    };

    logger.info(
      {
        objective: plan.objective.substring(0, 100),
        taskCount: plan.initialTasks.length,
      },
      "clarification_plan_regenerated",
    );

    return plan;
  } catch (error) {
    logger.error({ error, query, feedback }, "regenerate_plan_failed");
    throw error;
  }
}
