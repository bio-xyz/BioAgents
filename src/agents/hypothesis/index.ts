import type { ConversationState, Message, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import { generateHypothesis, type HypothesisDoc } from "./utils";

type HypothesisResult = {
  hypothesis: string;
  thought?: string;
  start: string;
  end: string;
  mode: "create" | "update";
};

/**
 * Hypothesis agent for deep research
 * Independent agent that generates or updates hypothesis without modifying state
 *
 * Flow:
 * 1. Take objective, message, and completed task results
 * 2. Pull relevant context from conversation state
 * 3. Determine if creating new hypothesis or updating existing one
 * 4. Use task outputs directly (with their objectives) to generate/update hypothesis
 * 5. Return hypothesis with timing information
 */
export async function hypothesisAgent(input: {
  objective: string;
  message: Message;
  conversationState: ConversationState;
  completedTasks: PlanTask[];
}): Promise<HypothesisResult> {
  const { objective, message, conversationState, completedTasks } = input;
  const start = new Date().toISOString();

  // Determine if we're creating or updating
  const currentHypothesis = conversationState.values.currentHypothesis;
  const mode: "create" | "update" = currentHypothesis ? "update" : "create";

  logger.info(
    {
      objective,
      mode,
      taskCount: completedTasks.length,
      hasCurrentHypothesis: !!currentHypothesis,
    },
    "hypothesis_agent_started",
  );

  try {
    // Build simple docs from task outputs
    const hypDocs: HypothesisDoc[] = [];

    // Add task outputs with their objectives
    completedTasks.forEach((task, index) => {
      logger.info(
        {
          taskIndex: index,
          taskType: task.type,
          hasOutput: !!task.output,
          outputLength: task.output?.length || 0,
          outputPreview: task.output?.substring(0, 100),
        },
        "processing_completed_task_for_hypothesis",
      );

      if (task.output && task.output.trim()) {
        hypDocs.push({
          title: `${task.type} Task Output`,
          text: `Task Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          context: `Output from ${task.type} task`,
        });
      }
    });

    // Add current hypothesis if updating
    if (currentHypothesis) {
      hypDocs.push({
        title: "Current Hypothesis",
        text: currentHypothesis,
        context: "Existing hypothesis to be updated with new findings",
      });
    }

    // Add conversation context
    const contextParts: string[] = [];
    if (conversationState.values.objective) {
      contextParts.push(
        `Main Objective: ${conversationState.values.objective}`,
      );
    }
    if (conversationState.values.currentObjective) {
      contextParts.push(
        `Current Objective: ${conversationState.values.currentObjective}`,
      );
    }
    if (conversationState.values.methodology) {
      contextParts.push(`Methodology: ${conversationState.values.methodology}`);
    }
    if (conversationState.values.keyInsights?.length) {
      contextParts.push(
        `Key Insights:\n${conversationState.values.keyInsights.join("\n")}`,
      );
    }

    if (contextParts.length > 0) {
      hypDocs.push({
        title: "Research Context",
        text: contextParts.join("\n\n"),
        context: "Overall research context",
      });
    }

    if (hypDocs.length === 0) {
      throw new Error("No data available for hypothesis generation");
    }

    logger.info({ docCount: hypDocs.length, mode }, "generating_hypothesis");

    // Generate or update hypothesis
    const { text, thought } = await generateHypothesis(
      message.question || objective,
      hypDocs,
      {
        maxTokens: 4000,
        thinking: true,
        thinkingBudget: 2048,
        mode,
        messageId: message.id,
        usageType: "deep-research",
      },
    );

    const end = new Date().toISOString();

    logger.info(
      {
        mode,
        fullHypothesis: text,
        fullHypDocs: hypDocs,
      },
      "hypothesis_agent_completed",
    );

    return {
      hypothesis: text,
      thought,
      start,
      end,
      mode,
    };
  } catch (err) {
    logger.error({ err, mode }, "hypothesis_agent_failed");
    throw err;
  }
}
