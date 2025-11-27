import { Elysia } from "elysia";
import { smartAuthMiddleware } from "../../middleware/smartAuth";
import { x402Middleware } from "../../middleware/x402";
import { recordPayment } from "../../services/chat/payment";
import {
  ensureUserAndConversation,
  setupConversationData,
  X402_SYSTEM_USER_ID,
} from "../../services/chat/setup";
import {
  createMessageRecord,
  executeFileUpload,
} from "../../services/chat/tools";
import type { ConversationState, PlanTask, State } from "../../types/core";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

type DeepResearchStartResponse = {
  messageId: string | null;
  conversationId: string;
  status: "processing";
  error?: string;
};

/**
 * Deep Research Start Route - Returns immediately with messageId
 * The actual research runs in the background
 */
const deepResearchStartPlugin = new Elysia()
  .use(
    smartAuthMiddleware({
      optional: true, // Allow unauthenticated requests (AI agents)
    }),
  )
  .use(x402Middleware());

// GET endpoint for x402scan discovery
export const deepResearchStartGet = deepResearchStartPlugin.get(
  "/api/deep-research-v2/start",
  async () => {
    return {
      message: "This endpoint requires POST method with payment.",
      apiDocumentation: "https://your-docs-url.com/api",
    };
  },
);

export const deepResearchStartRoute = deepResearchStartPlugin.post(
  "/api/deep-research-v2/start",
  async (ctx) => {
    const {
      body,
      set,
      request,
      paymentSettlement,
      paymentRequirement,
      paymentHeader,
    } = ctx as any;

    const parsedBody = body as any;
    const authenticatedUser = (request as any).authenticatedUser;

    // Extract message (REQUIRED)
    const message = parsedBody.message;
    if (!message) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required field: message",
      };
    }

    // Determine userId and source
    let userId: string;
    let source: string;

    if (authenticatedUser) {
      userId = authenticatedUser.userId;

      if (authenticatedUser.authMethod === "privy") {
        source = "external_ui";
      } else if (authenticatedUser.authMethod === "cdp") {
        source = "dev_ui";
      } else {
        source = authenticatedUser.authMethod;
      }
    } else {
      userId = X402_SYSTEM_USER_ID;
      source = "x402_agent";
    }

    // Auto-generate conversationId if not provided
    let conversationId = parsedBody.conversationId;
    if (!conversationId) {
      conversationId = generateUUID();
      if (logger) {
        logger.info(
          { conversationId, userId },
          "auto_generated_conversation_id",
        );
      }
    }

    // Extract files from parsed body
    let files: File[] = [];
    if (parsedBody.files) {
      if (Array.isArray(parsedBody.files)) {
        files = parsedBody.files.filter((f: any) => f instanceof File);
      } else if (parsedBody.files instanceof File) {
        files = [parsedBody.files];
      }
    }

    // Log request details
    if (logger) {
      logger.info(
        {
          userId,
          conversationId,
          source,
          authMethod: authenticatedUser?.authMethod,
          paidViaX402: !!paymentSettlement,
          messageLength: message.length,
          fileCount: files.length,
          routeType: "deep-research-v2-start",
        },
        "deep_research_start_request_received",
      );
    }

    // Ensure user and conversation exist
    const setupResult = await ensureUserAndConversation(
      userId,
      conversationId,
      authenticatedUser?.authMethod,
      source,
    );
    if (!setupResult.success) {
      set.status = 500;
      return { ok: false, error: setupResult.error || "Setup failed" };
    }

    // Setup conversation data
    const dataSetup = await setupConversationData(
      conversationId,
      userId,
      source,
      setupResult.isExternal || false,
      message,
      files.length,
      setupResult.isExternal
        ? parsedBody.userId || `agent_${Date.now()}`
        : undefined,
    );
    if (!dataSetup.success) {
      set.status = 500;
      return { ok: false, error: dataSetup.error || "Data setup failed" };
    }

    const { conversationStateRecord, stateRecord, x402ExternalRecord } =
      dataSetup.data!;

    // Create message record
    const messageResult = await createMessageRecord({
      conversationId,
      userId,
      message,
      source,
      stateId: stateRecord.id,
      files,
      isExternal: setupResult.isExternal || false,
    });
    if (!messageResult.success) {
      set.status = 500;
      return {
        ok: false,
        error: messageResult.error || "Message creation failed",
      };
    }

    const createdMessage = messageResult.message!;

    // Return immediately with message ID
    const response: DeepResearchStartResponse = {
      messageId: createdMessage.id,
      conversationId,
      status: "processing",
    };

    // Run the actual deep research in the background
    // Don't await - let it run asynchronously
    runDeepResearch({
      stateRecord,
      conversationStateRecord,
      createdMessage,
      files,
      setupResult,
      x402ExternalRecord,
      paymentSettlement,
      paymentHeader,
      paymentRequirement,
    }).catch((err) => {
      logger.error(
        { err, messageId: createdMessage.id },
        "deep_research_background_failed",
      );
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, conversationId },
        "deep_research_started",
      );
    }

    return response;
  },
);

/**
 * Background function that executes the deep research workflow
 */
async function runDeepResearch(params: {
  stateRecord: any;
  conversationStateRecord: any;
  createdMessage: any;
  files: File[];
  setupResult: any;
  x402ExternalRecord: any;
  paymentSettlement: any;
  paymentHeader: any;
  paymentRequirement: any;
}) {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    setupResult,
    x402ExternalRecord,
    paymentSettlement,
    paymentHeader,
    paymentRequirement,
  } = params;

  const startTime = Date.now();

  try {
    // Initialize state
    const state: State = {
      id: stateRecord.id,
      values: {
        messageId: createdMessage.id,
        conversationId: createdMessage.conversation_id,
        userId: createdMessage.user_id,
        source: createdMessage.source,
        isDeepResearch: true, // Flag indicating deep research mode
      },
    };

    // Initialize conversation state
    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    // Step 1: Process files if any
    if (files.length > 0) {
      await executeFileUpload({
        state,
        conversationState,
        message: createdMessage,
        files,
      });
    }

    // Step 2: Execute deep research planning agent (v2)
    const { planningAgent } = await import("../../agents/planning");
    const deepResearchPlanningResult = await planningAgent({
      state,
      conversationState,
      message: createdMessage,
    });

    const plan = deepResearchPlanningResult.plan;
    const currentObjective = deepResearchPlanningResult.currentObjective;

    if (!plan || !currentObjective) {
      throw new Error("Plan or current objective not found");
    }

    // Update conversation state with plan and objective
    const { updateConversationState } = await import("../../db/operations");
    const { literatureAgent } = await import("../../agents/literature");

    // Get current plan or initialize empty
    const currentPlan = conversationState.values.plan || [];

    // Find max level in current plan, default to -1 if empty
    const maxLevel =
      currentPlan?.length > 0
        ? Math.max(...currentPlan.map((t) => t.level || 0))
        : -1;

    // Add new tasks with appropriate level
    const newLevel = maxLevel + 1;
    const newTasks = plan.map((task: PlanTask) => ({
      ...task,
      level: newLevel,
      start: undefined,
      end: undefined,
      output: undefined,
    }));

    // Append to existing plan and update objective
    conversationState.values.plan = [...currentPlan, ...newTasks];
    conversationState.values.currentObjective = currentObjective;
    conversationState.values.currentLevel = newLevel; // Set current level for UI

    // Update state in DB
    if (conversationState.id) {
      await updateConversationState(
        conversationState.id,
        conversationState.values,
      );
      logger.info(
        { newLevel, taskCount: newTasks.length },
        "state_updated_with_plan_and_current_level",
      );
    }

    // Execute only tasks from the new level (max level)
    const tasksToExecute = conversationState.values.plan.filter(
      (t) => t.level === newLevel,
    );

    for (const task of tasksToExecute) {
      if (task.type === "LITERATURE") {
        // Set start timestamp
        task.start = new Date().toISOString();
        task.output = "";

        if (conversationState.id) {
          await updateConversationState(
            conversationState.id,
            conversationState.values,
          );
          logger.info("task_started");
        }

        logger.info(
          { taskObjective: task.objective },
          "executing_literature_task",
        );

        // Run OpenScholar and update state when done
        const openScholarPromise = literatureAgent({
          objective: task.objective,
          type: "OPENSCHOLAR",
        }).then(async (result) => {
          task.output += `OpenScholar literature results:\n${result.output}\n\n`;
          if (conversationState.id) {
            await updateConversationState(
              conversationState.id,
              conversationState.values,
            );
            logger.info("openscholar_completed");
          }
          logger.info(
            { outputLength: result.output.length },
            "openscholar_result_received",
          );
        });

        // Run Edison and update state when done
        // const edisonPromise = literatureAgent({
        //   objective: task.objective,
        //   type: "EDISON",
        // }).then(async (result) => {
        //   task.output += `Edison literature results:\n${result.output}\n\n`;
        //   if (conversationState.id) {
        //     await updateConversationState(
        //       conversationState.id,
        //       conversationState.values,
        //     );
        //     logger.info("edison_completed");
        //   }
        //   logger.info(
        //     { outputLength: result.output.length },
        //     "edison_result_received",
        //   );
        // });

        // const knowledgePromise = literatureAgent({
        //   objective: task.objective,
        //   type: "KNOWLEDGE",
        // }).then(async (result) => {
        //   task.output += `Knowledge literature results:\n${result.output}\n\n`;
        //   if (conversationState.id) {
        //     await updateState(conversationState.id, conversationState.values);
        //     logger.info("knowledge_completed");
        //   }
        //   logger.info({ outputLength: result.output.length }, "knowledge_result_received");
        // });

        // Wait for all to complete
        await Promise.all([
          openScholarPromise,
          // edisonPromise,
          // knowledgePromise,
        ]);

        // Set end timestamp after all are done
        task.end = new Date().toISOString();
        if (conversationState.id) {
          await updateConversationState(
            conversationState.id,
            conversationState.values,
          );
          logger.info("task_completed");
        }
      }
    }

    // Step 3: Generate/update hypothesis based on completed tasks
    logger.info("generating_hypothesis_from_completed_tasks");

    const { hypothesisAgent } = await import("../../agents/hypothesis");

    const hypothesisResult = await hypothesisAgent({
      objective: currentObjective,
      message: createdMessage,
      conversationState,
      completedTasks: tasksToExecute, // All tasks from current level
    });

    // Update conversation state with new hypothesis
    conversationState.values.currentHypothesis = hypothesisResult.hypothesis;
    if (conversationState.id) {
      await updateConversationState(
        conversationState.id,
        conversationState.values,
      );
      logger.info(
        {
          mode: hypothesisResult.mode,
          hypothesisLength: hypothesisResult.hypothesis.length,
        },
        "hypothesis_updated_in_state",
      );
    }

    // Step 4: Run reflection agent to update world state
    logger.info("running_reflection_agent_to_update_world");

    const { reflectionAgent } = await import("../../agents/reflection");

    const reflectionResult = await reflectionAgent({
      conversationState,
      message: createdMessage,
      completedMaxTasks: tasksToExecute, // MAX level tasks (current level)
      hypothesis: hypothesisResult.hypothesis,
    });

    // Update conversation state with reflection results
    conversationState.values.currentObjective =
      reflectionResult.currentObjective;
    conversationState.values.keyInsights = reflectionResult.keyInsights;
    conversationState.values.discoveries = reflectionResult.discoveries;
    conversationState.values.methodology = reflectionResult.methodology;

    if (conversationState.id) {
      await updateConversationState(
        conversationState.id,
        conversationState.values,
      );
      logger.info(
        {
          insightsCount: reflectionResult.keyInsights.length,
          discoveriesCount: reflectionResult.discoveries.length,
          hasNewObjective: !!reflectionResult.currentObjective,
        },
        "world_state_updated_via_reflection",
      );
    }

    // Step 5: Run planning agent in "next" mode to plan next iteration
    logger.info("running_next_planning_for_future_iteration");

    const nextPlanningResult = await planningAgent({
      state,
      conversationState,
      message: createdMessage,
      mode: "next",
    });

    // Only update if there's a plan (planner may return empty if research is complete)
    if (nextPlanningResult.plan.length > 0) {
      // Find max level in current plan
      const currentPlan = conversationState.values.plan || [];
      const maxLevel =
        currentPlan.length > 0
          ? Math.max(...currentPlan.map((t) => t.level || 0))
          : -1;

      // Add next iteration tasks with new level
      const nextLevel = maxLevel + 1;
      const nextTasks = nextPlanningResult.plan.map((task: PlanTask) => ({
        ...task,
        level: nextLevel,
        start: undefined,
        end: undefined,
        output: undefined,
      }));

      // Append to plan
      conversationState.values.plan = [...currentPlan, ...nextTasks];

      // Update objective if provided
      if (nextPlanningResult.currentObjective) {
        conversationState.values.currentObjective =
          nextPlanningResult.currentObjective;
      }

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
        logger.info(
          {
            nextLevel,
            nextTaskCount: nextTasks.length,
            nextObjective: nextPlanningResult.currentObjective,
          },
          "next_iteration_plan_added",
        );
      }
    } else {
      logger.info(
        "no_next_iteration_tasks_planned_research_complete_or_awaiting_feedback",
      );
    }

    // Step 6: Generate reply to user
    logger.info("generating_reply_to_user");

    const { replyAgent } = await import("../../agents/reply");

    const replyResult = await replyAgent({
      conversationState,
      message: createdMessage,
      completedMaxTasks: tasksToExecute,
      hypothesis: hypothesisResult.hypothesis,
      nextPlan: nextPlanningResult.plan,
    });

    logger.info(
      {
        replyLength: replyResult.reply.length,
      },
      "reply_generated",
    );

    // Step 7: Create assistant message with the reply
    const { createMessage } = await import("../../db/operations");

    const assistantMessage = await createMessage({
      conversation_id: createdMessage.conversation_id,
      user_id: createdMessage.user_id,
      content: replyResult.reply,
      source: createdMessage.source,
      question: createdMessage.question,
    });

    logger.info(
      { assistantMessageId: assistantMessage.id },
      "assistant_reply_saved",
    );

    const responseTime = 0; // TODO: Calculate response time

    // Record payment
    await recordPayment({
      isExternal: setupResult.isExternal || false,
      x402ExternalRecord,
      userId: createdMessage.user_id,
      conversationId: createdMessage.conversation_id,
      messageId: createdMessage.id,
      paymentSettlement,
      paymentHeader,
      paymentRequirement,
      providers: [], // Planning tool handles all providers internally
      responseTime,
    });

    if (logger) {
      logger.info(
        { messageId: createdMessage.id, responseTime },
        "deep_research_completed",
      );
    }
  } catch (err) {
    logger.error(
      { err, messageId: createdMessage.id },
      "deep_research_execution_failed",
    );

    // Update state to mark as failed
    const { updateState } = await import("../../db/operations");
    await updateState(stateRecord.id, {
      ...stateRecord.values,
      error: err instanceof Error ? err.message : "Unknown error",
      status: "failed",
    });
  }
}
