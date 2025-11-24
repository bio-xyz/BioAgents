import { getMessagesByConversation } from "../../db/operations";
import { LLM } from "../../llm/provider";
import type { ConversationState, Message, State } from "../../types/core";
import logger from "../../utils/logger";

type PlanTask = {
  objective: string;
  datasets: Array<{ filename: string; id: string; description: string }>;
  type: "LITERATURE" | "ANALYSIS";
};

type PlanningResult = {
  currentObjective: string;
  plan: PlanTask[];
};

/**
 * Planning agent for deep research
 * Plans next steps based on conversation state and previous results
 */
export async function planningAgent(input: {
  state: State;
  conversationState: ConversationState;
  message: Message;
}): Promise<PlanningResult> {
  const { state, conversationState, message } = input;

  // Check if this is the first message in conversation
  const isFirstMessage = await isFirstMessageInConversation(
    message.conversation_id,
  );

  // If first message, hardcode literature search plan
  if (isFirstMessage) {
    logger.info("First message in conversation, planning literature search");

    return {
      currentObjective:
        "Gather comprehensive literature to understand the current state of research on the deep research topic and inform the next steps.",
      plan: [
        {
          objective:
            "Search scientific literature from multiple sources to build a comprehensive knowledge base",
          datasets: [],
          type: "LITERATURE",
        },
      ],
    };
  }

  // Otherwise, use LLM to plan based on current state
  return await generatePlan(state, conversationState, message);
}

/**
 * Check if this is the first message in the conversation
 */
async function isFirstMessageInConversation(
  conversationId: string,
): Promise<boolean> {
  try {
    const messages = await getMessagesByConversation(conversationId, 1);
    return messages.length <= 1;
  } catch (err) {
    logger.error({ err }, "failed_to_check_conversation_history");
    return true; // Default to first message on error
  }
}

/**
 * Generate plan using LLM based on current state
 */
async function generatePlan(
  state: State,
  conversationState: ConversationState,
  message: Message,
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

  const planningPrompt = `You are a research planning agent. Your job is to plan the NEXT immediate steps based on the current research state.

IMPORTANT INSTRUCTIONS:
- Focus on planning the NEXT steps
- DO NOT plan too far into the future - keep it focused and actionable
- Incorporate latest results into your thinking
- Tasks will be executed in PARALLEL, so if tasks depend on each other, only plan the first ones
- Tailor the objective to the specific type of task
- If you believe the main objective has been achieved, set the objective to "Main objective achieved" and your plan should be empty

CURRENT RESEARCH STATE:
${context}

USER'S LATEST REQUEST:
${message.question}

AVAILABLE TASK TYPES (only these two):
- LITERATURE: Search and gather scientific papers and knowledge from literature databases
- ANALYSIS: Perform computational/data analysis on datasets (can include uploaded files as datasets)

OUTPUT FORMAT (respond with ONLY valid JSON):
{
  "currentObjective": "Updated objective for the next phase of research (1-2 sentences)",
  "plan": [
    {
      "objective": "Specific objective tailored to this task",
      "datasets": [{filename: "", id: "", description: string}], // Dataset metadata, only for ANALYSIS tasks
      "type": "LITERATURE or ANALYSIS"
    }
  ]
}

NOTES:
- For LITERATURE tasks: datasets array should be EMPTY []
- For ANALYSIS tasks: SELECT which uploaded datasets (shown in the CURRENT RESEARCH STATE above) are relevant for the analysis task
  - Only include datasets that are directly relevant to the specific analysis objective
  - Copy the exact dataset objects (filename, id, description) from the "Uploaded Datasets" section above
  - If no datasets are uploaded or none are relevant, use an empty array
- Plan only 1-3 tasks maximum
- If tasks depend on each other, only plan the first ones (next ones will be handled in the next iteration)
- Update the objective to reflect what you're currently doing and what comes after these tasks
- Be specific and actionable`;

  const response = await llmProvider.createChatCompletion({
    model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: planningPrompt,
      },
    ],
    maxTokens: 1024,
  });

  const rawContent = response.content.trim();

  // Try to extract JSON from markdown code blocks if present
  const jsonMatch = rawContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonString = jsonMatch ? jsonMatch[1] || "" : rawContent || "";

  const result = JSON.parse(jsonString) as PlanningResult;

  logger.info(
    {
      currentObjective: result.currentObjective,
      planLength: result.plan.length,
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

  return contextParts.length > 0
    ? contextParts.join("\n")
    : "No previous results available";
}
