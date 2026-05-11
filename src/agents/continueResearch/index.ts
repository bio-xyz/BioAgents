import { getMessagesByConversation } from "../../db/operations";
import type { ConversationState, Message, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import { type ContinueResearchDoc, type DatasetInfo, decideContinuation } from "./utils";

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
  const datasets: DatasetInfo[] = (conversationState.values.uploadedDatasets || []).map((d) => ({
    description: d.description || "",
    filename: d.filename,
    id: d.id,
    size: d.size,
  }));

  // Get user's last message from DB (not from current message which may be agent-initiated)
  let userLastMessage = "";
  try {
    const messages = await getMessagesByConversation(
      message.conversation_id,
      20 // Check last 20 messages
    );
    // Messages are newest-first; find the most recent with a non-empty question.
    // Continuation messages have question="" so they are skipped.
    const lastUserMsg = messages?.find((m) => m.question && m.question.trim());
    userLastMessage = lastUserMsg?.question || "";
  } catch (err) {
    logger.warn({ err }, "failed_to_fetch_user_last_message");
  }

  logger.info(
    {
      allTaskCount: conversationState.values.plan?.length || 0,
      completedTaskCount: completedTasks.length,
      datasetCount: datasets.length,
      hasHypothesis: !!hypothesis,
      hasUserMessage: !!userLastMessage,
      iterationCount,
      researchMode,
      suggestedNextStepsCount: suggestedNextSteps.length,
    },
    "continue_research_agent_started"
  );

  try {
    // Edge case: No suggested next steps means research is complete
    if (suggestedNextSteps.length === 0) {
      logger.info("no_suggested_next_steps_research_complete");
      const end = new Date().toISOString();
      return {
        confidence: "high",
        end,
        reasoning:
          "No further research steps suggested. The research objective appears to be addressed.",
        shouldContinue: false,
        start,
        triggerReason: "research_convergence",
      };
    }

    // STEERING MODE: Always stop after each iteration to let user steer
    if (researchMode === "steering") {
      logger.info({ iterationCount }, "steering_mode_asking_user");
      const end = new Date().toISOString();
      return {
        confidence: "high",
        end,
        reasoning: "Steering mode - pausing for user feedback after each iteration.",
        shouldContinue: false,
        start,
        triggerReason: "steering_mode",
      };
    }

    // FULLY AUTONOMOUS MODE: Only stop when research is complete
    // Skip LLM decision - just continue if there are next steps
    if (researchMode === "fully-autonomous") {
      logger.info(
        { iterationCount, suggestedNextStepsCount: suggestedNextSteps.length },
        "fully_autonomous_auto_continue"
      );
      const end = new Date().toISOString();
      return {
        confidence: "high",
        end,
        reasoning:
          "Fully autonomous mode - continuing research as there are still steps to explore.",
        shouldContinue: true,
        start,
      };
    }

    // SEMI-AUTONOMOUS MODE: Use LLM to decide based on various criteria

    // First iteration should almost always continue
    if (iterationCount === 1 && suggestedNextSteps.length > 0) {
      logger.info({ iterationCount }, "first_iteration_auto_continue");
      const end = new Date().toISOString();
      return {
        confidence: "high",
        end,
        reasoning:
          "First iteration completed. Continuing to build foundational understanding before seeking user feedback.",
        shouldContinue: true,
        start,
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
          context: `Current iteration - ${task.type} task`,
          text: `Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          title: `${task.type} Task`,
        });
      }
    });

    // Add hypothesis if available
    if (hypothesis) {
      docs.push({
        context: "Working hypothesis synthesized from all iterations",
        text: hypothesis,
        title: "Current Hypothesis",
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
      conversationState.values.evolvingObjective ||
        conversationState.values.objective ||
        message.question ||
        "",
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
        messageId: message.id,
        thinkingBudget: 2048,
        usageType: "deep-research",
      }
    );

    const end = new Date().toISOString();

    logger.info(
      {
        confidence: result.confidence,
        iterationCount,
        reasoning: result.reasoning,
        researchMode,
        shouldContinue: result.shouldContinue,
        triggerReason: result.triggerReason,
        userLastMessagePreview: userLastMessage?.substring(0, 100),
      },
      "continue_research_decision"
    );

    return {
      ...result,
      end,
      start,
    };
  } catch (err) {
    logger.error({ err }, "continue_research_agent_failed");
    // On error, default to asking user (safer)
    const end = new Date().toISOString();
    return {
      confidence: "low",
      end,
      reasoning: "Error during decision making. Defaulting to user feedback.",
      shouldContinue: false,
      start,
      triggerReason: "error",
    };
  }
}
