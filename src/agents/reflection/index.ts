import type {
  ConversationState,
  Message,
  PlanTask,
} from "../../types/core";
import logger from "../../utils/logger";
import { reflectOnWorld, type ReflectionDoc } from "./utils";

type ReflectionResult = {
  objective?: string; // Only set if research direction fundamentally changed
  conversationTitle?: string;
  currentObjective?: string;
  keyInsights: string[];
  methodology?: string;
  start: string;
  end: string;
};

/**
 * Reflection agent for deep research
 * Independent agent that updates the world state based on completed MAX level tasks
 *
 * Flow:
 * 1. Take world (conversationState), message, completed MAX level tasks, and hypothesis
 * 2. Integrate results from all completed tasks
 * 3. Update world state: currentObjective, keyInsights, methodology
 * 4. Return updated world state with timing information
 *
 * Note: Discoveries are now handled by a separate discovery agent
 */
export async function reflectionAgent(input: {
  conversationState: ConversationState;
  message: Message;
  completedMaxTasks: PlanTask[];
  hypothesis?: string;
}): Promise<ReflectionResult> {
  const { conversationState, message, completedMaxTasks, hypothesis } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      hasObjective: !!conversationState.values.objective,
      taskCount: completedMaxTasks.length,
      hasHypothesis: !!hypothesis,
      currentInsights: conversationState.values.keyInsights?.length || 0,
    },
    "reflection_agent_started",
  );

  try {
    // Build reflection docs from completed MAX level tasks
    const reflectionDocs: ReflectionDoc[] = [];

    // Add completed MAX level task outputs
    completedMaxTasks.forEach((task, index) => {
      logger.info(
        {
          taskIndex: index,
          taskType: task.type,
          taskLevel: task.level,
          hasOutput: !!task.output,
          outputLength: task.output?.length || 0,
        },
        "processing_max_level_task_for_reflection",
      );

      if (task.output && task.output.trim()) {
        reflectionDocs.push({
          title: `${task.type} Task (Level ${task.level}) Output`,
          text: `Task Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          context: `Output from level ${task.level} ${task.type} task`,
        });
      }
    });

    // Add hypothesis if available
    if (hypothesis) {
      reflectionDocs.push({
        title: "Current Hypothesis",
        text: hypothesis,
        context: "Working hypothesis from completed tasks",
      });
    }

    // Add existing world state
    const worldContextParts: string[] = [];
    if (conversationState.values.objective) {
      worldContextParts.push(
        `Main Objective: ${conversationState.values.objective}`,
      );
    }
    if (conversationState.values.currentObjective) {
      worldContextParts.push(
        `Current Objective: ${conversationState.values.currentObjective}`,
      );
    }
    if (conversationState.values.methodology) {
      worldContextParts.push(
        `Current Methodology: ${conversationState.values.methodology}`,
      );
    }
    if (conversationState.values.keyInsights?.length) {
      worldContextParts.push(
        `Existing Key Insights (${conversationState.values.keyInsights.length}):\n${conversationState.values.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")}`,
      );
    }

    if (worldContextParts.length > 0) {
      reflectionDocs.push({
        title: "Current World State",
        text: worldContextParts.join("\n\n"),
        context: "Existing world state to be updated",
      });
    }

    if (reflectionDocs.length === 0) {
      logger.warn("No data available for reflection, returning current state");
      const end = new Date().toISOString();
      return {
        conversationTitle: conversationState.values.conversationTitle,
        currentObjective: conversationState.values.currentObjective,
        keyInsights: conversationState.values.keyInsights || [],
        methodology: conversationState.values.methodology,
        start,
        end,
      };
    }

    logger.info(
      { docCount: reflectionDocs.length },
      "reflecting_on_world_state",
    );

    // Reflect and update world state
    const { text, thought } = await reflectOnWorld(
      message.question || conversationState.values.objective || "",
      reflectionDocs,
      {
        maxTokens: 4000,
        thinking: true,
        thinkingBudget: 4096,
        messageId: message.id,
        usageType: "deep-research",
        // Pass existing values to preserve on parse failure
        existingObjective: conversationState.values.currentObjective,
        existingInsights: conversationState.values.keyInsights,
        existingMethodology: conversationState.values.methodology,
        existingTitle: conversationState.values.conversationTitle,
      },
    );

    const end = new Date().toISOString();

    logger.info(
      {
        updatedWorld: text,
        thought,
        reflectionDocs,
      },
      "reflection_agent_completed",
    );

    return {
      ...text,
      start,
      end,
    };
  } catch (err) {
    logger.error({ err }, "reflection_agent_failed");
    throw err;
  }
}
