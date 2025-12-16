import character from "../../character";
import { LLM } from "../../llm/provider";
import type {
  ConversationState,
  Message,
  PlanTask,
  State,
} from "../../types/core";
import logger from "../../utils/logger";
import {
  INITIAL_PLANNING_NO_PLAN_PROMPT,
  INITIAL_PLANNING_PROMPT,
  NEXT_PLANNING_PROMPT,
} from "./prompts";

export type PlanningResult = {
  currentObjective: string;
  plan: Array<PlanTask>;
};

export type PlanningMode = "initial" | "next";

/**
 * Planning agent for deep research
 * Plans next steps based on conversation state and previous results
 *
 * Two modes:
 * - "initial": Creates tasks for the current iteration (default, used at start of each message)
 *              If no plan exists yet, creates an initial literature search plan
 * - "next": Updates plan for next iteration after reflection (used after hypothesis + reflection)
 */
export async function planningAgent(input: {
  state: State;
  conversationState: ConversationState;
  message: Message;
  mode?: PlanningMode;
}): Promise<PlanningResult> {
  const { state, conversationState, message, mode = "initial" } = input;

  // Check if plan is empty (indicates first planning or fresh start)
  const hasPlan =
    conversationState.values.plan && conversationState.values.plan.length > 0;

  // If no existing plan and initial mode, use LLM with no-plan prompt
  if (!hasPlan && mode === "initial") {
    logger.info("No existing plan found, using LLM for initial planning");
    return await generateInitialPlan(message, conversationState);
  }

  // Otherwise, use LLM to plan based on current state
  return await generatePlan(state, conversationState, message, mode);
}

/**
 * Generate initial plan when no plan exists yet
 * Uses LLM with special prompt that suggests 1 LITERATURE task
 */
async function generateInitialPlan(
  message: Message,
  conversationState: ConversationState,
): Promise<PlanningResult> {
  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const planningApiKey =
    process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!planningApiKey) {
    throw new Error(
      `${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey: planningApiKey,
  });

  // Build context (may include uploaded datasets even if no plan exists)
  const context = buildContextFromState(conversationState);

  const planningPrompt = INITIAL_PLANNING_NO_PLAN_PROMPT.replace(
    "{context}",
    context,
  ).replace("{userMessage}", message.question);

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
    systemInstruction: character.system,
  });

  const rawContent = response.content.trim();

  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonString = jsonMatch ? jsonMatch[1] || "" : rawContent || "";

  let result: PlanningResult;
  try {
    result = JSON.parse(jsonString) as PlanningResult;
  } catch (error) {
    // try to locate the json inbetween {} in the message content
    const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
    const jsonString = jsonMatch ? jsonMatch[0] || "" : "";
    result = JSON.parse(jsonString) as PlanningResult;
  }

  logger.info(
    {
      mode: "initial_no_plan",
      currentObjective: result.currentObjective,
      plan: result.plan.map(
        (t) =>
          `${t.type} task: ${t.objective} datasets: ${t.datasets.map((d) => `${d.filename} (${d.description})`).join(", ")}`,
      ),
    },
    "initial_plan_generated",
  );

  return result;
}

/**
 * Generate plan using LLM based on current state
 */
async function generatePlan(
  state: State,
  conversationState: ConversationState,
  message: Message,
  mode: PlanningMode = "initial",
): Promise<PlanningResult> {
  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const planningApiKey =
    process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!planningApiKey) {
    throw new Error(
      `${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY is not configured.`,
    );
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey: planningApiKey,
  });

  // Build context from latest results
  const context = buildContextFromState(conversationState);

  // Select prompt based on mode
  const promptTemplate =
    mode === "initial" ? INITIAL_PLANNING_PROMPT : NEXT_PLANNING_PROMPT;

  // Replace placeholders
  const planningPrompt = promptTemplate
    .replace("{context}", context)
    .replace("{userMessage}", message.question);

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
    systemInstruction: character.system,
  });

  const rawContent = response.content.trim();

  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonString = jsonMatch ? jsonMatch[1] || "" : rawContent || "";

  let result: PlanningResult;
  try {
    result = JSON.parse(jsonString) as PlanningResult;
  } catch (error) {
    // try to locate the json inbetween {} in the message content
    const jsonMatch = message.content.match(
      /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
    );
    const jsonString = jsonMatch ? jsonMatch[1] || "" : "";
    result = JSON.parse(jsonString) as PlanningResult;
  }

  logger.info(
    {
      mode,
      currentObjective: result.currentObjective,
      plan: result.plan.map(
        (t) =>
          `${t.type} task: ${t.objective} datasets: ${t.datasets.map((d) => `${d.filename} (${d.description})`).join(", ")}`,
      ),
    },
    "plan_generated",
  );

  return result;
}

/**
 * Build context string from current state
 */
function buildContextFromState(conversationState: ConversationState): string {
  const contextParts: string[] = [];

  // Add hypothesis if available
  if (conversationState.values.currentHypothesis) {
    contextParts.push(
      `Current Hypothesis: ${conversationState.values.currentHypothesis}`,
    );
  }

  if (conversationState.values.objective) {
    contextParts.push(
      `Main Objective (the user message that kicked off the research): ${conversationState.values.objective}`,
    );
  }

  if (conversationState.values.currentObjective) {
    contextParts.push(
      `Current Objective (the current goal of the research, updated after each research iteration): ${conversationState.values.currentObjective}`,
    );
  }

  if (conversationState.values.keyInsights?.length) {
    contextParts.push(
      `Key Insights (from the deep research conversation): ${conversationState.values.keyInsights.length}`,
    );
  }

  if (conversationState.values.uploadedDatasets?.length) {
    contextParts.push(
      `Uploaded Datasets:\n${conversationState.values.uploadedDatasets
        .map((ds) => `  - ${ds.filename} (ID: ${ds.id}): ${ds.description}`)
        .join("\n")}`,
    );
  }

  // Add suggested next steps if available (from previous iteration's "next" planning)
  if (conversationState.values.suggestedNextSteps?.length) {
    const suggestionsText = conversationState.values.suggestedNextSteps
      .map((task, i) => {
        let taskText = `  ${i + 1}. [${task.type}] ${task.objective}`;
        if (task.datasets?.length) {
          taskText += `\n     Datasets: ${task.datasets.map((d) => `${d.filename} (${d.id})`).join(", ")}`;
        }
        return taskText;
      })
      .join("\n");

    contextParts.push(
      `Suggested Next Steps (from previous iteration):\n${suggestionsText}`,
    );
  }

  return contextParts.length > 0
    ? contextParts.join("\n")
    : "No previous results available";
}
