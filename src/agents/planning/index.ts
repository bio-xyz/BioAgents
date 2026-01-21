import character from "../../character";
import { LLM } from "../../llm/provider";
import { getUploadPath } from "../../storage";
import type {
  ConversationState,
  Message,
  PlanTask,
  State,
} from "../../types/core";
import logger from "../../utils/logger";
import { extractPlanningResult } from "../../utils/planningJsonExtractor";
import { formatFileSize } from "../fileUpload/utils";
import {
  INITIAL_PLANNING_NO_PLAN_PROMPT,
  INITIAL_PLANNING_PROMPT,
  NEXT_PLANNING_PROMPT,
} from "./prompts";

/**
 * Resolve dataset paths for planned tasks
 * - For artifacts: looks up path by artifact ID from completed tasks
 * - For uploaded files: uses uploads/{filename} path
 */
function resolveDatasetPaths(
  newTasks: PlanTask[],
  existingPlan: PlanTask[],
): PlanTask[] {
  const artifactMap = new Map<string, string>();

  for (const task of existingPlan) {
    if (task.artifacts) {
      for (const artifact of task.artifacts) {
        if (artifact.id && artifact.path) {
          artifactMap.set(artifact.id, artifact.path);
        }
      }
    }
  }

  return newTasks.map((task) => ({
    ...task,
    datasets: task.datasets.map((dataset) => {
      const path = artifactMap.get(dataset.id);
      if (path) {
        return { ...dataset, path };
      }
      return { ...dataset, path: getUploadPath(dataset.filename) };
    }),
  }));
}

export type PlanningResult = {
  currentObjective: string;
  plan: Array<PlanTask>;
};

export type PlanningMode = "initial" | "next";
export type ResearchMode = "semi-autonomous" | "fully-autonomous" | "steering";

/**
 * Planning agent for deep research
 * Plans next steps based on conversation state and previous results
 *
 * Two modes:
 * - "initial": Creates tasks for the current iteration (default, used at start of each message)
 *              If no plan exists yet, creates an initial literature search plan
 * - "next": Updates plan for next iteration after reflection (used after hypothesis + reflection)
 */
export type TokenUsageType = "chat" | "deep-research" | "paper-generation";

export async function planningAgent(input: {
  state: State;
  conversationState: ConversationState;
  message: Message;
  mode?: PlanningMode;
  usageType?: TokenUsageType;
  researchMode?: ResearchMode;
}): Promise<PlanningResult> {
  const { state, conversationState, message, mode = "initial", usageType, researchMode = "semi-autonomous" } = input;

  // Check if plan is empty (indicates first planning or fresh start)
  const hasPlan =
    conversationState.values.plan && conversationState.values.plan.length > 0;

  let result: PlanningResult;

  // If no existing plan and initial mode, use LLM with no-plan prompt
  if (!hasPlan && mode === "initial") {
    logger.info("No existing plan found, using LLM for initial planning");
    result = await generateInitialPlan(message, conversationState, usageType, researchMode);
  } else {
    // Otherwise, use LLM to plan based on current state
    result = await generatePlan(state, conversationState, message, mode, usageType, researchMode);
  }

  // Resolve dataset paths before returning
  result.plan = resolveDatasetPaths(result.plan, conversationState.values.plan || []);

  return result;
}

/**
 * Get research mode guidance text for prompts
 */
function getResearchModeGuidance(researchMode: ResearchMode): string {
  switch (researchMode) {
    case "steering":
      return `RESEARCH MODE: STEERING
- User will review outputs after this iteration, so plan focused, self-contained tasks
- Each task should produce clear, actionable results the user can evaluate`;
    case "fully-autonomous":
      return `RESEARCH MODE: FULLY AUTONOMOUS
- System will continue iterating automatically, so plan comprehensive tasks
- You can plan foundational work that subsequent iterations will build upon
- Feel free to explore broader scope - future iterations can refine and follow up`;
    default: // semi-autonomous
      return "RESEARCH MODE: SEMI-AUTONOMOUS: No specific guidance for semi-autonomous mode"; // Prompts are written for semi-autonomous by default
  }
}

/**
 * Generate initial plan when no plan exists yet
 * Uses LLM with special prompt that suggests 1 LITERATURE task
 */
async function generateInitialPlan(
  message: Message,
  conversationState: ConversationState,
  usageType?: TokenUsageType,
  researchMode: ResearchMode = "semi-autonomous",
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
  const conversationId =
    conversationState.values.conversationId || message.conversation_id;
  const context = await buildContextFromState(
    conversationState,
    conversationId,
  );

  const planningPrompt = INITIAL_PLANNING_NO_PLAN_PROMPT.replace(
    "{context}",
    context,
  ).replace("{userMessage}", message.question)
    .replace("{researchModeGuidance}", getResearchModeGuidance(researchMode));

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
    thinkingBudget: 2048,
    systemInstruction: character.system,
    messageId: message.id,
    usageType,
  });

  const rawContent = response.content.trim();

  // Extract planning result with multi-strategy fallback
  const result = extractPlanningResult(rawContent, message.question);

  logger.info(
    {
      mode: "initial_no_plan",
      currentObjective: result.currentObjective,
      plan: result.plan.map(
        (t) =>
          `${t.type} task: ${t.objective} datasets: ${t.datasets?.map((d) => `${d.filename} (${d.description})`).join(", ") || "none"}`,
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
  usageType?: TokenUsageType,
  researchMode: ResearchMode = "semi-autonomous",
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
  const conversationId =
    conversationState.values.conversationId || state.values.conversationId;
  const context = await buildContextFromState(
    conversationState,
    conversationId,
  );

  // Select prompt based on mode
  const promptTemplate =
    mode === "initial" ? INITIAL_PLANNING_PROMPT : NEXT_PLANNING_PROMPT;

  // Replace placeholders
  const planningPrompt = promptTemplate
    .replace("{context}", context)
    .replace("{userMessage}", message.question)
    .replace("{researchModeGuidance}", getResearchModeGuidance(researchMode));

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
    thinkingBudget: 2048,
    systemInstruction: character.system,
    messageId: message.id,
    usageType,
  });

  const rawContent = response.content.trim();

  // Extract planning result with multi-strategy fallback
  const result = extractPlanningResult(rawContent, message.question);

  logger.info(
    {
      mode,
      currentObjective: result.currentObjective,
      plan: result.plan.map(
        (t) =>
          `${t.type} task: ${t.objective} datasets: ${t.datasets?.map((d) => `${d.filename} (${d.description})`).join(", ") || "none"}`,
      ),
    },
    "plan_generated",
  );

  return result;
}

/**
 * Build context string from current state
 */
async function buildContextFromState(
  conversationState: ConversationState,
  conversationId?: string,
): Promise<string> {
  const contextParts: string[] = [];

  // Add recent conversation history if available
  if (conversationId) {
    try {
      const { getMessagesByConversation } = await import("../../db/operations");
      // Fetch 4 messages, then skip the first one (current message)
      const allMessages = await getMessagesByConversation(conversationId, 4);

      if (allMessages && allMessages.length > 1) {
        // Skip the first message (most recent = current one), take next 3
        const previousMessages = allMessages.slice(1, 4);

        // Reverse to get chronological order (oldest to newest)
        const orderedMessages = previousMessages.reverse();

        const conversationHistory = orderedMessages
          .map((msg) => {
            const parts: string[] = [];

            // Each message has both user question and agent response
            if (msg.question) {
              parts.push(`User: ${msg.question}`);
            }

            // Use summary for agent response if available, otherwise truncate content
            if (msg.summary) {
              parts.push(`Assistant: ${msg.summary}`);
            } else if (msg.content) {
              const content =
                msg.content.length > 300
                  ? msg.content.substring(0, 300) + "..."
                  : msg.content;
              parts.push(`Assistant: ${content}`);
            }

            return parts.join("\n");
          })
          .join("\n\n");

        if (conversationHistory) {
          contextParts.push(
            `Recent Conversation History (last ${orderedMessages.length} exchanges):\n${conversationHistory}`,
          );
        }
      }
    } catch (error) {
      logger.warn(
        { error },
        "Failed to fetch conversation history for planning",
      );
    }
  }

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
      `Key Insights:\n${conversationState.values.keyInsights.map((insight, i) => `  ${i + 1}. ${insight}`).join("\n")}`,
    );
  }

  // Add discoveries if available
  if (conversationState.values.discoveries?.length) {
    const discoveriesText = conversationState.values.discoveries
      .map((discovery, i) => {
        let text = `  ${i + 1}. ${discovery.title}\n     Claim: ${discovery.claim}\n     Summary: ${discovery.summary}`;
        if (discovery.evidenceArray?.length) {
          text += `\n     Evidence: ${discovery.evidenceArray.length} supporting task(s)`;
        }
        if (discovery.novelty) {
          text += `\n     Novelty: ${discovery.novelty}`;
        }
        return text;
      })
      .join("\n\n");

    contextParts.push(`Discoveries:\n${discoveriesText}`);
  }

  if (conversationState.values.uploadedDatasets?.length) {
    contextParts.push(
      `Uploaded Datasets:\n${conversationState.values.uploadedDatasets
        .map((ds) => {
          const sizeStr = ds.size ? ` [${formatFileSize(ds.size)}]` : "";
          return `  - ${ds.filename}${sizeStr} (ID: ${ds.id}): ${ds.description}`;
        })
        .join("\n")}`,
    );
  }

  // Add artifacts from completed analysis tasks
  const completedAnalysisTasks =
    conversationState.values.plan?.filter(
      (task) => task.type === "ANALYSIS" && task.end && task.artifacts?.length,
    ) || [];

  if (completedAnalysisTasks.length > 0) {
    const artifactsText = completedAnalysisTasks
      .flatMap((task) =>
        task.artifacts!.map((artifact) => {
          return `  - ${artifact.name} (id: ${artifact.id}) [from ${task.id}]: ${artifact.description}`;
        }),
      )
      .join("\n");

    contextParts.push(
      `Available Artifacts (from completed analysis tasks):\n${artifactsText}`,
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
