import { Elysia } from "elysia";
import { initKnowledgeBase } from "../../agents/literature/knowledge";
import { authBeforeHandle } from "../../middleware/auth";
import {
  ensureUserAndConversation,
  setupConversationData,
} from "../../services/chat/setup";
import { createMessageRecord } from "../../services/chat/tools";
import type { ConversationState, PlanTask, State } from "../../types/core";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

initKnowledgeBase();

type DeepResearchStartResponse = {
  messageId: string | null;
  conversationId: string;
  userId: string; // Important: Return userId so external platforms can check status
  status: "processing";
  error?: string;
};

/**
 * Deep Research Start Route - Returns immediately with messageId
 * The actual research runs in the background
 * Uses guard pattern to ensure auth runs for all routes
 */
export const deepResearchStartRoute = new Elysia().guard(
  {
    beforeHandle: [
      authBeforeHandle({
        optional: process.env.NODE_ENV !== "production",
      }),
    ],
  },
  (app) =>
    app
      .get("/api/deep-research/start", async () => {
        return {
          message: "This endpoint requires POST method.",
          apiDocumentation: "https://your-docs-url.com/api",
        };
      })
      .post("/api/deep-research/start", deepResearchStartHandler),
);

/**
 * Deep Research Start Handler - Core logic for POST /api/deep-research/start
 * Exported for reuse in x402 routes
 */
export async function deepResearchStartHandler(ctx: any) {
  const { body, set, request } = ctx;

  const parsedBody = body as any;

  // Extract message (REQUIRED)
  const message = parsedBody.message;
  if (!message) {
    set.status = 400;
    return {
      ok: false,
      error: "Missing required field: message",
    };
  }

  // Determine userId: x402 wallet > body.userId > anonymous
  let userId: string;
  let source = "api";
  let isX402User = false;

  // Check if this is an x402 request with wallet payment
  const x402Settlement = (request as any).x402Settlement;
  if (x402Settlement?.payer) {
    // x402 user - get or create user by wallet address
    const { getOrCreateUserByWallet } = await import("../../db/operations");
    const { user, isNew } = await getOrCreateUserByWallet(x402Settlement.payer);
    userId = user.id;
    source = "x402";
    isX402User = true;

    logger.info(
      {
        userId,
        wallet: x402Settlement.payer,
        isNewUser: isNew,
        transaction: x402Settlement.transaction,
      },
      "x402_user_identified",
    );
  } else {
    // Regular API request - use provided userId or generate anonymous
    const providedUserId = parsedBody.userId;
    const isValidUserId =
      providedUserId &&
      typeof providedUserId === "string" &&
      providedUserId.length > 0 &&
      providedUserId !== "undefined" &&
      providedUserId !== "null";

    userId = isValidUserId ? providedUserId : `anon_${Date.now()}`;

    if (!isValidUserId) {
      logger.warn(
        { generatedUserId: userId },
        "deep_research_no_user_id_provided_generating_temp",
      );
    }

    logger.info({ userId, source }, "deep_research_user_identified");
  }

  // Auto-generate conversationId if not provided
  let conversationId = parsedBody.conversationId;
  if (!conversationId) {
    conversationId = generateUUID();
    if (logger) {
      logger.info({ conversationId, userId }, "auto_generated_conversation_id");
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
        message: message,
        fileCount: files.length,
        routeType: "deep-research-v2-start",
      },
      "deep_research_start_request_received",
    );
  }

  // Ensure user and conversation exist
  // Skip user creation for x402 users (already created by getOrCreateUserByWallet)
  const setupResult = await ensureUserAndConversation(userId, conversationId, {
    skipUserCreation: isX402User,
  });
  if (!setupResult.success) {
    set.status = 500;
    return { ok: false, error: setupResult.error || "Setup failed" };
  }

  // Setup conversation data
  const dataSetup = await setupConversationData(
    conversationId,
    userId,
    source,
    false, // isExternal
    message,
    files.length,
  );
  if (!dataSetup.success) {
    set.status = 500;
    return { ok: false, error: dataSetup.error || "Data setup failed" };
  }

  const { conversationStateRecord, stateRecord } = dataSetup.data!;

  // Create message record
  const messageResult = await createMessageRecord({
    conversationId,
    userId,
    message,
    source,
    stateId: stateRecord.id,
    files,
    isExternal: false,
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
  // Include userId so external platforms (x402) can check status later
  const response: DeepResearchStartResponse = {
    messageId: createdMessage.id,
    conversationId,
    userId, // Important for x402 users who may not have provided one
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
}

/**
 * Background function that executes the deep research workflow
 */
async function runDeepResearch(params: {
  stateRecord: any;
  conversationStateRecord: any;
  createdMessage: any;
  files: File[];
  setupResult: any;
}) {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    setupResult,
  } = params;

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
      const { fileUploadAgent } = await import("../../agents/fileUpload");

      const fileResult = await fileUploadAgent({
        conversationState,
        files,
        userId: state.values.userId || "unknown",
      });

      logger.info(
        {
          uploadedDatasets: fileResult.uploadedDatasets,
          errors: fileResult.errors,
          fileCount: files.length,
        },
        "file_upload_agent_result",
      );
    }

    // Step 2: Execute deep research planning agent (v2)
    const { planningAgent } = await import("../../agents/planning");

    logger.info(
      { suggestedNextSteps: conversationState.values.suggestedNextSteps },
      "current_suggested_next_steps",
    );

    const deepResearchPlanningResult = await planningAgent({
      state,
      conversationState,
      message: createdMessage,
      mode: "initial",
    });

    const plan = deepResearchPlanningResult.plan;
    const currentObjective = deepResearchPlanningResult.currentObjective;

    if (!plan || !currentObjective) {
      throw new Error("Plan or current objective not found");
    }

    // Update conversation state with plan and objective
    const { updateConversationState } = await import("../../db/operations");
    const { literatureAgent } = await import("../../agents/literature");

    // Clear previous suggestions since we're starting a new iteration
    conversationState.values.suggestedNextSteps = [];

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
        { newLevel, newTasks, newObjective: currentObjective },
        "new_tasks_added_to_plan",
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
        const edisonPromise = literatureAgent({
          objective: task.objective,
          type: "EDISON",
        }).then(async (result) => {
          task.output += `Edison literature results:\n${result.output}\n\n`;
          if (conversationState.id) {
            await updateConversationState(
              conversationState.id,
              conversationState.values,
            );
          }
          logger.info(
            { outputLength: result.output.length },
            "edison_result_received",
          );
        });

        const knowledgePromise = literatureAgent({
          objective: task.objective,
          type: "KNOWLEDGE",
        }).then(async (result) => {
          task.output += `Knowledge literature results:\n${result.output}\n\n`;
          if (conversationState.id) {
            await updateConversationState(
              conversationState.id,
              conversationState.values,
            );
            logger.info("knowledge_completed");
          }
          logger.info(
            { outputLength: result.output.length },
            "knowledge_result_received",
          );
        });

        // Wait for all to complete
        await Promise.all([
          openScholarPromise,
          edisonPromise,
          knowledgePromise,
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
      } else if (task.type === "ANALYSIS") {
        // Set start timestamp
        task.start = new Date().toISOString();
        task.output = "";

        if (conversationState.id) {
          await updateConversationState(
            conversationState.id,
            conversationState.values,
          );
        }

        logger.info(
          {
            taskObjective: task.objective,
            datasets: task.datasets.map((d) => `${d.filename} (${d.id})`),
          },
          "executing_analysis_task",
        );

        // Run Edison analysis
        const { analysisAgent } = await import("../../agents/analysis");

        try {
          // MOCK: Uncomment to skip actual analysis for faster testing
          const MOCK_ANALYSIS = false;

          let analysisResult;
          if (MOCK_ANALYSIS) {
            logger.info("using_mock_analysis_for_testing");
            analysisResult = {
              objective: task.objective,
              output: `## Differential Gene Expression Analysis: Caloric Restriction vs Control

**Datasets Analyzed:** ${task.datasets.map((d) => d.filename).join(", ")}

### Analysis Approach
Performed differential expression analysis comparing caloric restriction (CR) vs control groups using normalized read counts. Statistical significance assessed using t-tests with multiple testing correction (FDR < 0.05).

### Key Findings

**1. Autophagy and Nutrient Sensing Pathways**

The analysis reveals significant modulation of autophagy-related genes under caloric restriction:

- **Atg7** shows 1.52-fold upregulation (p = 0.003) in CR vs control groups (Autophagy gene 7 upregulation promotes longevity)[10.1038/nature24630]
- **Ulk1** exhibits 1.46-fold increase (p = 0.007), suggesting enhanced autophagy initiation (ULK1 activation extends lifespan in mammals)[10.1016/j.cell.2019.02.013]
- **Becn1** demonstrates moderate upregulation (1.19-fold, p = 0.021), consistent with autophagosome formation (Beclin 1 is required for CR-mediated longevity)[10.1126/science.aar2814]

**2. mTOR Pathway Suppression**

- **Mtor** shows significant downregulation (0.65-fold, p = 0.001) under CR conditions (mTOR inhibition is sufficient to extend lifespan)[10.1126/science.1215135]
- **Igf1r** reduced by 0.63-fold (p = 0.002), indicating decreased insulin/IGF-1 signaling (Reduced IGF-1 signaling extends lifespan across species)[10.1038/nature08619]

**3. Transcriptional Regulators**

- **Foxo1** upregulated 1.48-fold (p = 0.004), suggesting enhanced stress resistance (FOXO transcription factors regulate longevity)[10.1038/nrg.2016.4]
- **Ppara** shows 1.34-fold increase (p = 0.008), indicating metabolic remodeling (PPARα activation promotes healthy aging)[10.1016/j.cmet.2018.05.024]
- **Tfeb** upregulated 1.56-fold (p = 0.002), consistent with enhanced lysosomal biogenesis (TFEB drives longevity through autophagy-lysosomal pathway)[10.1016/j.celrep.2016.12.063]

**4. Lysosomal Function**

- **Lamp2** increased 1.24-fold (p = 0.015), supporting enhanced autophagy flux (LAMP2 is essential for autophagy-mediated lifespan extension)[10.1080/15548627.2018.1474314]

**5. Sirtuin Activation**

- **Sirt1** shows 1.64-fold upregulation (p = 0.001), the highest fold-change observed (SIRT1 activation extends lifespan via NAD+ metabolism)[10.1016/j.cell.2013.05.041]

### Correlation with Lifespan Extension

Analysis of the lifespan data shows CR treatment resulted in a mean lifespan increase of 25.7% (control: 712 ± 25 days vs CR: 892 ± 23 days, p < 0.001).

**Gene-Lifespan Correlations:**
- Sirt1 expression strongly correlates with lifespan (r = 0.87, p < 0.001)
- Atg7 expression correlates with lifespan (r = 0.79, p = 0.002)
- Mtor expression inversely correlates with lifespan (r = -0.81, p = 0.001)

### Biological Interpretation

The gene expression signature reveals a coordinated response to caloric restriction characterized by:

1. **Enhanced autophagy**: Upregulation of Atg7, Ulk1, Becn1, and Tfeb indicates increased autophagosome formation and lysosomal degradation
2. **Reduced growth signaling**: Downregulation of mTOR and IGF-1R suggests decreased nutrient sensing and growth promotion
3. **Metabolic reprogramming**: PPARα upregulation indicates shift toward fatty acid oxidation
4. **Stress resistance**: FOXO1 and SIRT1 upregulation suggests enhanced cellular stress response

These molecular changes align with established longevity pathways (Converging nutrient sensing pathways regulate lifespan)[10.1016/j.cmet.2017.06.013] and provide mechanistic insight into CR-mediated lifespan extension in this model system.

### Statistical Summary
- Total genes analyzed: 10
- Significantly upregulated (FDR < 0.05): 7 genes
- Significantly downregulated (FDR < 0.05): 2 genes
- Mean lifespan increase under CR: 25.7% (p < 0.001)
- Batch effects: Not significant (p = 0.34)`,
              start: new Date().toISOString(),
              end: new Date().toISOString(),
            };
          } else {
            const type =
              process.env.PRIMARY_ANALYSIS_AGENT?.toUpperCase() === "BIO"
                ? "BIO"
                : "EDISON";
            const conversationStateId = conversationState.id!; // Use conversation_state ID to match upload path
            analysisResult = await analysisAgent({
              objective: task.objective,
              datasets: task.datasets,
              type,
              userId: createdMessage.user_id,
              conversationStateId: conversationStateId,
            });
          }

          task.output = `Analysis results:\n${analysisResult.output}\n\n`;

          if (conversationState.id) {
            await updateConversationState(
              conversationState.id,
              conversationState.values,
            );
            logger.info("analysis_completed");
          }

          logger.info(
            { outputLength: analysisResult.output.length },
            "analysis_result_received",
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          task.output = `Analysis failed: ${errorMsg}`;
          logger.error(
            { error, taskObjective: task.objective },
            "analysis_failed",
          );
        }

        // Set end timestamp
        task.end = new Date().toISOString();
        if (conversationState.id) {
          await updateConversationState(
            conversationState.id,
            conversationState.values,
          );
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
          hypothesis: hypothesisResult.hypothesis,
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
          insights: reflectionResult.keyInsights,
          discoveries: reflectionResult.discoveries,
          currentObjective: reflectionResult.currentObjective,
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

    // Save suggestions for next iteration (don't add to plan yet - wait for user confirmation)
    if (nextPlanningResult.plan.length > 0) {
      // Store as suggestions (without level - will be assigned when user confirms)
      conversationState.values.suggestedNextSteps = nextPlanningResult.plan;

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
            nextPlanningSteps: nextPlanningResult.plan.map(
              (t) =>
                `${t.type} task: ${t.objective} datasets: ${t.datasets.map((d) => `${d.filename} (${d.description})`).join(", ")}`,
            ),
            nextObjective: nextPlanningResult.currentObjective,
          },
          "next_iteration_suggestions_saved",
        );
      }
    } else {
      logger.info(
        "no_next_iteration_tasks_suggested_research_complete_or_awaiting_feedback",
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
      nextPlan: conversationState.values.suggestedNextSteps || [],
    });

    logger.info(
      {
        reply: replyResult.reply,
      },
      "reply_generated",
    );

    // Step 7: Update the message with the reply content
    const { updateMessage } = await import("../../db/operations");

    await updateMessage(createdMessage.id, {
      content: replyResult.reply,
    });

    logger.info(
      { messageId: createdMessage.id, contentLength: replyResult.reply.length },
      "message_content_saved",
    );
    const responseTime = 0; // TODO: Calculate response time

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
