import type { ConversationState, Message, PlanTask } from "../../types/core";
import logger from "../../utils/logger";
import { type ReflectionDoc, reflectOnWorld } from "./utils";

type ReflectionResult = {
  conversationTitle?: string;
  evolvingObjective?: string;
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
      currentInsights: conversationState.values.keyInsights?.length || 0,
      hasHypothesis: !!hypothesis,
      hasObjective: !!conversationState.values.objective,
      taskCount: completedMaxTasks.length,
    },
    "reflection_agent_started"
  );

  try {
    // Build reflection docs from completed MAX level tasks
    const reflectionDocs: ReflectionDoc[] = [];

    // Add completed MAX level task outputs
    completedMaxTasks.forEach((task, index) => {
      logger.info(
        {
          hasOutput: !!task.output,
          outputLength: task.output?.length || 0,
          taskIndex: index,
          taskLevel: task.level,
          taskType: task.type,
        },
        "processing_max_level_task_for_reflection"
      );

      if (task.output && task.output.trim()) {
        reflectionDocs.push({
          context: `Output from level ${task.level} ${task.type} task`,
          text: `Task Objective: ${task.objective}\n\nOutput:\n${task.output}`,
          title: `${task.type} Task (Level ${task.level}) Output`,
        });
      }
    });

    // Add hypothesis if available
    if (hypothesis) {
      reflectionDocs.push({
        context: "Working hypothesis from completed tasks",
        text: hypothesis,
        title: "Current Hypothesis",
      });
    }

    // Add existing world state
    const worldContextParts: string[] = [];
    if (conversationState.values.objective) {
      worldContextParts.push(`Main Objective: ${conversationState.values.objective}`);
    }
    if (conversationState.values.evolvingObjective) {
      worldContextParts.push(
        `Evolving Research Direction: ${conversationState.values.evolvingObjective}`
      );
    }
    if (conversationState.values.currentObjective) {
      worldContextParts.push(`Current Objective: ${conversationState.values.currentObjective}`);
    }
    if (conversationState.values.methodology) {
      worldContextParts.push(`Current Methodology: ${conversationState.values.methodology}`);
    }
    if (conversationState.values.keyInsights?.length) {
      worldContextParts.push(
        `Existing Key Insights (${conversationState.values.keyInsights.length}):\n${conversationState.values.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")}`
      );
    }

    if (worldContextParts.length > 0) {
      reflectionDocs.push({
        context: "Existing world state to be updated",
        text: worldContextParts.join("\n\n"),
        title: "Current World State",
      });
    }

    if (reflectionDocs.length === 0) {
      logger.warn("No data available for reflection, returning current state");
      const end = new Date().toISOString();
      return {
        conversationTitle: conversationState.values.conversationTitle,
        currentObjective: conversationState.values.currentObjective,
        end,
        evolvingObjective: conversationState.values.evolvingObjective,
        keyInsights: conversationState.values.keyInsights || [],
        methodology: conversationState.values.methodology,
        start,
      };
    }

    logger.info({ docCount: reflectionDocs.length }, "reflecting_on_world_state");

    // Reflect and update world state
    const { text, thought } = await reflectOnWorld(
      message.question || conversationState.values.objective || "",
      reflectionDocs,
      {
        existingEvolvingObjective: conversationState.values.evolvingObjective,
        existingInsights: conversationState.values.keyInsights,
        existingMethodology: conversationState.values.methodology,
        // Pass existing values to preserve on parse failure
        existingObjective: conversationState.values.currentObjective,
        existingTitle: conversationState.values.conversationTitle,
        maxTokens: 4000,
        messageId: message.id,
        thinking: true,
        thinkingBudget: 4096,
        usageType: "deep-research",
      }
    );

    const end = new Date().toISOString();

    logger.info(
      {
        reflectionDocs,
        thought,
      },
      "reflection_agent_completed"
    );

    return {
      ...text,
      end,
      start,
    };
  } catch (err) {
    logger.error({ err }, "reflection_agent_failed");
    throw err;
  }
}
