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
      hasCurrentHypothesis: !!currentHypothesis,
      mode,
      objective,
      taskCount: completedTasks.length,
    },
    "hypothesis_agent_started"
  );

  try {
    // Build simple docs from task outputs
    const hypDocs: HypothesisDoc[] = [];

    // Add task outputs with their objectives
    completedTasks.forEach((task, index) => {
      logger.info(
        {
          hasOutput: !!task.output,
          outputLength: task.output?.length || 0,
          outputPreview: task.output?.substring(0, 100),
          taskIndex: index,
          taskType: task.type,
        },
        "processing_completed_task_for_hypothesis"
      );

      if (task.output && task.output.trim()) {
        hypDocs.push({
          context: `Output from ${task.type} task`,
          text: `Task Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          title: `${task.type} Task Output`,
        });
      }
    });

    // Add current hypothesis if updating
    if (currentHypothesis) {
      hypDocs.push({
        context: "Existing hypothesis to be updated with new findings",
        text: currentHypothesis,
        title: "Current Hypothesis",
      });
    }

    // Add conversation context
    const contextParts: string[] = [];
    if (conversationState.values.objective) {
      contextParts.push(`Main Objective: ${conversationState.values.objective}`);
    }
    if (conversationState.values.evolvingObjective) {
      contextParts.push(
        `Evolving Research Direction: ${conversationState.values.evolvingObjective}`
      );
    }
    if (conversationState.values.currentObjective) {
      contextParts.push(`Current Objective: ${conversationState.values.currentObjective}`);
    }
    if (conversationState.values.methodology) {
      contextParts.push(`Methodology: ${conversationState.values.methodology}`);
    }
    if (conversationState.values.keyInsights?.length) {
      contextParts.push(`Key Insights:\n${conversationState.values.keyInsights.join("\n")}`);
    }

    if (contextParts.length > 0) {
      hypDocs.push({
        context: "Overall research context",
        text: contextParts.join("\n\n"),
        title: "Research Context",
      });
    }

    if (hypDocs.length === 0) {
      throw new Error("No data available for hypothesis generation");
    }

    logger.info({ docCount: hypDocs.length, mode }, "generating_hypothesis");

    // Generate or update hypothesis
    const { text, thought } = await generateHypothesis(message.question || objective, hypDocs, {
      maxTokens: 4000,
      messageId: message.id,
      mode,
      thinking: true,
      thinkingBudget: 2048,
      usageType: "deep-research",
    });

    const end = new Date().toISOString();

    logger.info(
      {
        fullHypDocs: hypDocs,
        fullHypothesis: text,
        mode,
      },
      "hypothesis_agent_completed"
    );

    return {
      end,
      hypothesis: text,
      mode,
      start,
      thought,
    };
  } catch (err) {
    logger.error({ err, mode }, "hypothesis_agent_failed");
    throw err;
  }
}
