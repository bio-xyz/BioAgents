import type { ConversationState, Message, PlanTask } from "../../types/core";
import { getMessagesByConversation } from "../../db/operations";
import logger from "../../utils/logger";
import {
  decideContinuation,
  type ContinueResearchDoc,
  type DatasetInfo,
} from "./utils";

export type ContinueResearchResult = {
  shouldContinue: boolean;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  triggerReason?: string;
  start: string;
  end: string;
};

/**
 * Continue Research agent for deep research
 * Decides whether to continue autonomously or ask user for feedback
 *
 * Flow:
 * 1. Takes conversation state, completed tasks, hypothesis, and suggested next steps
 * 2. Analyzes all task outputs across all iterations
 * 3. Applies decision criteria (contradictions, convergence, marginal value, etc.)
 * 4. Returns decision with reasoning
 */
export async function continueResearchAgent(input: {
  conversationState: ConversationState;
  message: Message;
  completedTasks: PlanTask[];
  hypothesis: string;
  suggestedNextSteps: PlanTask[];
  iterationCount: number;
  researchMode?: "semi-autonomous" | "fully-autonomous" | "steering";
}): Promise<ContinueResearchResult> {
  const {
    conversationState,
    message,
    completedTasks,
    hypothesis,
    suggestedNextSteps,
    iterationCount,
    researchMode = "semi-autonomous",
  } = input;
  const start = new Date().toISOString();

  // Extract datasets from conversation state
  const datasets: DatasetInfo[] = (
    conversationState.values.uploadedDatasets || []
  ).map((d) => ({
    filename: d.filename,
    id: d.id,
    description: d.description || "",
    size: d.size,
  }));

  // Get user's last message from DB (not from current message which may be agent-initiated)
  let userLastMessage = "";
  try {
    const messages = await getMessagesByConversation(
      message.conversation_id,
      20, // Check last 20 messages
    );
    // Find the most recent message with a non-empty question (user message)
    const lastUserMsg = messages?.find((m) => m.question && m.question.trim());
    userLastMessage = lastUserMsg?.question || "";
  } catch (err) {
    logger.warn({ err }, "failed_to_fetch_user_last_message");
  }

  logger.info(
    {
      iterationCount,
      completedTaskCount: completedTasks.length,
      allTaskCount: conversationState.values.plan?.length || 0,
      suggestedNextStepsCount: suggestedNextSteps.length,
      hasHypothesis: !!hypothesis,
      datasetCount: datasets.length,
      hasUserMessage: !!userLastMessage,
      researchMode,
    },
    "continue_research_agent_started",
  );

  try {
    // Edge case: No suggested next steps means research is complete
    if (suggestedNextSteps.length === 0) {
      logger.info("no_suggested_next_steps_research_complete");
      const end = new Date().toISOString();
      return {
        shouldContinue: false,
        reasoning:
          "No further research steps suggested. The research objective appears to be addressed.",
        confidence: "high",
        triggerReason: "research_convergence",
        start,
        end,
      };
    }

    // STEERING MODE: Always stop after each iteration to let user steer
    if (researchMode === "steering") {
      logger.info({ iterationCount }, "steering_mode_asking_user");
      const end = new Date().toISOString();
      return {
        shouldContinue: false,
        reasoning:
          "Steering mode - pausing for user feedback after each iteration.",
        confidence: "high",
        triggerReason: "steering_mode",
        start,
        end,
      };
    }

    // FULLY AUTONOMOUS MODE: Only stop when research is complete
    // Skip LLM decision - just continue if there are next steps
    if (researchMode === "fully-autonomous") {
      logger.info(
        { iterationCount, suggestedNextStepsCount: suggestedNextSteps.length },
        "fully_autonomous_auto_continue",
      );
      const end = new Date().toISOString();
      return {
        shouldContinue: true,
        reasoning:
          "Fully autonomous mode - continuing research as there are still steps to explore.",
        confidence: "high",
        start,
        end,
      };
    }

    // SEMI-AUTONOMOUS MODE: Use LLM to decide based on various criteria

    // First iteration should almost always continue
    if (iterationCount === 1 && suggestedNextSteps.length > 0) {
      logger.info({ iterationCount }, "first_iteration_auto_continue");
      const end = new Date().toISOString();
      return {
        shouldContinue: true,
        reasoning:
          "First iteration completed. Continuing to build foundational understanding before seeking user feedback.",
        confidence: "high",
        start,
        end,
      };
    }

    // Build documents for LLM analysis
    const docs: ContinueResearchDoc[] = [];

    // Add task outputs from the latest iteration only (to keep prompt size manageable)
    const allTasks = conversationState.values.plan || [];
    const maxLevel = Math.max(...allTasks.map((t) => t.level || 0), 0);
    const latestIterationTasks = allTasks.filter((t) => t.level === maxLevel);

    latestIterationTasks.forEach((task) => {
      if (task.output && task.output.trim()) {
        docs.push({
          title: `${task.type} Task`,
          text: `Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          context: `Current iteration - ${task.type} task`,
        });
      }
    });

    // Add hypothesis if available
    if (hypothesis) {
      docs.push({
        title: "Current Hypothesis",
        text: hypothesis,
        context: "Working hypothesis synthesized from all iterations",
      });
    }

    // Format suggested next steps
    const suggestedNextStepsText = suggestedNextSteps
      .map((step, i) => {
        let text = `${i + 1}. [${step.type}] ${step.objective}`;
        if (step.datasets?.length) {
          text += `\n   Datasets: ${step.datasets.map((d) => d.filename).join(", ")}`;
        }
        return text;
      })
      .join("\n");

    // Call LLM for decision
    const result = await decideContinuation(
      conversationState.values.objective || message.question || "",
      conversationState.values.currentObjective || "",
      iterationCount,
      hypothesis,
      conversationState.values.keyInsights || [],
      conversationState.values.discoveries || [],
      docs,
      suggestedNextStepsText,
      userLastMessage,
      datasets,
      {
        maxTokens: 1024,
        thinkingBudget: 2048,
        messageId: message.id,
        usageType: "deep-research",
      },
    );

    const end = new Date().toISOString();

    logger.info(
      {
        shouldContinue: result.shouldContinue,
        confidence: result.confidence,
        triggerReason: result.triggerReason,
        reasoning: result.reasoning,
      },
      "continue_research_agent_completed",
    );

    return {
      ...result,
      start,
      end,
    };
  } catch (err) {
    logger.error({ err }, "continue_research_agent_failed");
    // On error, default to asking user (safer)
    const end = new Date().toISOString();
    return {
      shouldContinue: false,
      reasoning: "Error during decision making. Defaulting to user feedback.",
      confidence: "low",
      triggerReason: "error",
      start,
      end,
    };
  }
}
