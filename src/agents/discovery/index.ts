import type {
  ConversationState,
  Discovery,
  Message,
  PlanTask,
} from "../../types/core";
import logger from "../../utils/logger";
import { extractDiscoveries, fixDiscoveryArtifactPaths, type DiscoveryDoc } from "./utils";

type DiscoveryAgentResult = {
  discoveries: Discovery[];
  start: string;
  end: string;
};

/**
 * Discovery agent for deep research mode
 * Identifies and structures scientific discoveries from completed tasks
 *
 * Flow:
 * 1. Takes tasks to consider, existing discoveries, and hypothesis
 * 2. Extracts scientifically rigorous discoveries from ANALYSIS tasks
 * 3. Updates existing discoveries with new evidence or creates new ones
 * 4. Returns updated discoveries array with timing information
 *
 * Note: Caller determines which tasks to pass based on context (all tasks for initial run, new tasks for incremental updates)
 */
export async function discoveryAgent(input: {
  conversationState: ConversationState;
  message: Message;
  tasksToConsider: PlanTask[]; // Tasks to analyze for discoveries (caller decides which ones)
  hypothesis?: string;
}): Promise<DiscoveryAgentResult> {
  const { conversationState, message, tasksToConsider, hypothesis } = input;
  const start = new Date().toISOString();

  logger.info(
    {
      tasksToConsiderCount: tasksToConsider.length,
      hasHypothesis: !!hypothesis,
      currentDiscoveries: conversationState.values.discoveries?.length || 0,
    },
    "discovery_agent_started",
  );

  try {
    // Build discovery docs from tasks to consider
    const discoveryDocs: DiscoveryDoc[] = [];

    // Add task outputs
    tasksToConsider.forEach((task, index) => {
      logger.info(
        {
          taskIndex: index,
          taskType: task.type,
          taskId: task.id,
          hasOutput: !!task.output,
          outputLength: task.output?.length || 0,
        },
        "processing_task_for_discovery",
      );

      if (task.output && task.output.trim()) {
        discoveryDocs.push({
          title: task.objective,
          text: `Task ID: ${task.id}\nJob ID: ${task.jobId || "N/A"}\nTask Type: ${task.type}\n\nOutput:\n${task.output}`,
          context: `Output from ${task.type} task (${task.id}, Job ID: ${task.jobId || "N/A"})`,
        });
      }
    });

    // Add hypothesis if available
    if (hypothesis) {
      discoveryDocs.push({
        title: "Current Hypothesis",
        text: hypothesis,
        context: "Working hypothesis from completed tasks",
      });
    }

    // Build conversation history from recent messages
    let conversationHistory = `Research Question: ${message.question || conversationState.values.objective}
Current Objective: ${conversationState.values.currentObjective || "Not set"}`;

    const conversationId = message.conversation_id;
    if (conversationId) {
      try {
        const { getMessagesByConversation } = await import(
          "../../db/operations"
        );
        // Fetch 6 messages (current + 5 previous), then skip the first one (current message)
        const allMessages = await getMessagesByConversation(conversationId, 6);

        if (allMessages && allMessages.length > 1) {
          // Skip the first message (most recent = current one), take next 5
          const previousMessages = allMessages.slice(1, 6);

          // Reverse to get chronological order (oldest to newest)
          const orderedMessages = previousMessages.reverse();

          const messageHistory = orderedMessages
            .map((msg) => {
              const parts: string[] = [];

              // Each message has both user question and agent response
              if (msg.question) {
                parts.push(`User: ${msg.question}`);
              }

              // Use summary for agent response
              if (msg.summary) {
                parts.push(`Assistant: ${msg.summary}`);
              }

              return parts.join("\n");
            })
            .join("\n\n");

          if (messageHistory) {
            conversationHistory += `\n\nRecent Conversation History (last ${orderedMessages.length} exchanges):\n${messageHistory}`;
          }
        }
      } catch (error) {
        logger.warn(
          { error },
          "Failed to fetch conversation history for discovery agent",
        );
      }
    }

    if (discoveryDocs.length === 0) {
      logger.warn(
        "No task outputs available for discovery extraction, returning current discoveries",
      );
      const end = new Date().toISOString();
      return {
        discoveries: conversationState.values.discoveries || [],
        start,
        end,
      };
    }

    logger.info(
      { docCount: discoveryDocs.length },
      "extracting_discoveries_from_tasks",
    );

    // Extract discoveries
    const { discoveries } = await extractDiscoveries(
      message.question || conversationState.values.objective || "",
      conversationState.values.discoveries || [],
      conversationHistory,
      discoveryDocs,
      {
        maxTokens: 8000,
        messageId: message.id,
        usageType: "deep-research",
      },
    );

    // Fix artifact paths by matching against task artifacts
    // LLM may output sandbox paths or filenames - we need correct storage paths
    const fixedDiscoveries = fixDiscoveryArtifactPaths(discoveries, tasksToConsider);

    const end = new Date().toISOString();

    logger.info(
      {
        discoveryCount: fixedDiscoveries.length,
        discoveries: fixedDiscoveries,
      },
      "discovery_agent_completed",
    );

    return {
      discoveries: fixedDiscoveries,
      start,
      end,
    };
  } catch (err) {
    logger.error({ err }, "discovery_agent_failed");
    throw err;
  }
}
