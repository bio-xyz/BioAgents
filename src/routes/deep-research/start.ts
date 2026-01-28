import { Elysia } from "elysia";
import { analysisAgent } from "../../agents/analysis";
import { continueResearchAgent } from "../../agents/continueResearch";
import { discoveryAgent } from "../../agents/discovery";
import { fileUploadAgent } from "../../agents/fileUpload";
import { hypothesisAgent } from "../../agents/hypothesis";
import { literatureAgent } from "../../agents/literature";
import { initKnowledgeBase } from "../../agents/literature/knowledge";
import { planningAgent } from "../../agents/planning";
import { reflectionAgent } from "../../agents/reflection";
import { replyAgent } from "../../agents/reply";
import {
  getMessagesByConversation,
  getOrCreateUserByWallet,
  updateConversationState,
  updateMessage,
  updateState,
} from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";
import {
  ensureUserAndConversation,
  setupConversationData,
} from "../../services/chat/setup";
import { createMessageRecord } from "../../services/chat/tools";
import { isJobQueueEnabled } from "../../services/queue/connection";
import { notifyMessageUpdated } from "../../services/queue/notify";
import { getDeepResearchQueue } from "../../services/queue/queues";
import type { AuthContext } from "../../types/auth";
import type { ConversationState, PlanTask, State } from "../../types/core";
import {
  calculateSessionStartLevel,
  createContinuationMessage,
  getSessionCompletedTasks,
} from "../../utils/deep-research/continuation-utils";
import { getDiscoveryRunConfig } from "../../utils/discovery";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";

initKnowledgeBase();

/**
 * Response type for deep research start (in-process mode)
 */
type DeepResearchStartResponse = {
  messageId: string | null;
  conversationId: string;
  userId: string; // Important: Return userId so external platforms can check status
  status: "processing";
  pollUrl?: string; // Full URL for x402 users to check status
  error?: string;
};

/**
 * Response type for deep research start (queue mode)
 */
type DeepResearchQueuedResponse = {
  jobId: string;
  messageId: string;
  conversationId: string;
  userId: string;
  status: "queued";
  pollUrl: string;
};

/**
 * Deep Research Start Route - Returns immediately with messageId
 * The actual research runs in the background
 * Uses guard pattern to ensure auth runs for all routes
 *
 * Supports dual mode:
 * - USE_JOB_QUEUE=false (default): Fire-and-forget async execution
 * - USE_JOB_QUEUE=true: Enqueues job to BullMQ for worker processing
 */
export const deepResearchStartRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true, // Always require auth - no environment-based bypass
      }),
      rateLimitMiddleware("deep-research"),
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

  // Get userId from auth context (set by authResolver middleware)
  // Auth context handles: x402 wallet > JWT token > API key > body.userId > anonymous
  const auth = (request as any).auth as AuthContext | undefined;
  let userId = auth?.userId || generateUUID();
  const source = auth?.method === "x402" ? "x402" : "api";
  const isX402User = auth?.method === "x402";

  logger.info(
    {
      userId,
      authMethod: auth?.method || "unknown",
      verified: auth?.verified || false,
      source,
      externalId: auth?.externalId,
    },
    "deep_research_user_identified_via_auth",
  );

  // For x402 users, ensure wallet user record exists and use the actual user ID
  if (isX402User && auth?.externalId) {
    const { user, isNew } = await getOrCreateUserByWallet(auth.externalId);

    // Use the actual database user ID (may differ from auth.userId)
    userId = user.id;

    logger.info(
      {
        userId: user.id,
        wallet: auth.externalId,
        isNewUser: isNew,
      },
      "x402_user_record_ensured",
    );
  }

  // Auto-generate conversationId if not provided
  let conversationId = parsedBody.conversationId;
  if (!conversationId) {
    conversationId = generateUUID();
    if (logger) {
      logger.info({ conversationId, userId }, "auto_generated_conversation_id");
    }
  }

  // Extract researchMode from request (will be reconciled with conversation state later)
  // Modes: 'semi-autonomous' (default), 'fully-autonomous', 'steering'
  type ResearchMode = "semi-autonomous" | "fully-autonomous" | "steering";
  const requestedResearchMode: ResearchMode | undefined = parsedBody.researchMode;

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

  // Log with state IDs now that we have them
  logger.info(
    {
      userId,
      conversationId,
      conversationStateId: conversationStateRecord.id,
      stateId: stateRecord.id,
      messagePreview: message.length > 200 ? message.substring(0, 200) + "..." : message,
      messageLength: message.length,
    },
    "deep_research_state_initialized",
  );

  // Reconcile researchMode: request takes priority, then existing state, then default
  const researchMode: ResearchMode = requestedResearchMode
    || conversationStateRecord.values.researchMode
    || "semi-autonomous";

  // Save researchMode to conversation state (allows it to change per request)
  conversationStateRecord.values.researchMode = researchMode;

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

  // =========================================================================
  // DUAL MODE: Check if job queue is enabled
  // =========================================================================
  if (isJobQueueEnabled()) {
    // QUEUE MODE: Enqueue job and return immediately
    logger.info(
      { messageId: createdMessage.id, conversationId },
      "deep_research_using_queue_mode",
    );

    // Process files synchronously before enqueuing (files can't be serialized)
    if (files.length > 0) {
      const conversationState: ConversationState = {
        id: conversationStateRecord.id,
        values: conversationStateRecord.values,
      };

      logger.info(
        { fileCount: files.length },
        "processing_file_uploads_before_queue",
      );

      await fileUploadAgent({
        conversationState,
        files,
        userId,
      });
    }

    // Enqueue the job (iteration 1)
    const deepResearchQueue = getDeepResearchQueue();

    const job = await deepResearchQueue.add(
      `iteration-1-${createdMessage.id}`,
      {
        userId,
        conversationId,
        messageId: createdMessage.id,
        message,
        authMethod: auth?.method || "anonymous",
        stateId: stateRecord.id,
        conversationStateId: conversationStateRecord.id,
        requestedAt: new Date().toISOString(),
        researchMode,
        // Iteration tracking (iteration-per-job architecture)
        iterationNumber: 1,
        isInitialIteration: true,
        // rootJobId will be set by worker to job.id since this is the first job
      },
      {
        jobId: createdMessage.id, // Use message ID as job ID for easy lookup
      },
    );

    logger.info(
      {
        jobId: job.id,
        messageId: createdMessage.id,
        conversationId,
      },
      "deep_research_job_enqueued",
    );

    // Build pollUrl - use full URL for x402 users (external API consumers)
    let pollUrl = `/api/deep-research/status/${createdMessage.id}`;
    if (isX402User) {
      const url = new URL(request.url);
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const protocol = forwardedProto || url.protocol.replace(":", "");
      pollUrl = `${protocol}://${url.host}/api/deep-research/status/${createdMessage.id}`;
    }

    const response: DeepResearchQueuedResponse = {
      jobId: job.id!,
      messageId: createdMessage.id,
      conversationId,
      userId,
      status: "queued",
      pollUrl,
    };

    return new Response(JSON.stringify(response), {
      status: 202, // Accepted
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  // =========================================================================
  // IN-PROCESS MODE: Fire-and-forget async execution (existing behavior)
  // =========================================================================
  logger.info(
    { messageId: createdMessage.id, conversationId },
    "deep_research_using_in_process_mode",
  );

  // Return immediately with message ID
  // Include userId so external platforms (x402) can check status later
  // Build pollUrl for x402 users (external API consumers)
  let statusPollUrl: string | undefined;
  if (isX402User) {
    const url = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || url.protocol.replace(":", "");
    statusPollUrl = `${protocol}://${url.host}/api/deep-research/status/${createdMessage.id}`;
  }

  const response: DeepResearchStartResponse = {
    messageId: createdMessage.id,
    conversationId,
    userId, // Important for x402 users who may not have provided one
    status: "processing",
    ...(statusPollUrl && { pollUrl: statusPollUrl }),
  };

  // Run the actual deep research in the background
  // Don't await - let it run asynchronously
  runDeepResearch({
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    researchMode,
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
 *
 * Research modes:
 * - 'semi-autonomous' (default): Uses MAX_AUTO_ITERATIONS from env (default 5)
 * - 'fully-autonomous': Continues until research is done or hard cap of 20 iterations
 * - 'steering': Single iteration only, always asks user for feedback
 */
async function runDeepResearch(params: {
  stateRecord: any;
  conversationStateRecord: any;
  createdMessage: any;
  files: File[];
  researchMode?: "semi-autonomous" | "fully-autonomous" | "steering";
}) {
  const {
    stateRecord,
    conversationStateRecord,
    createdMessage,
    files,
    researchMode = "semi-autonomous",
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

    // =========================================================================
    // AUTONOMOUS ITERATION LOOP
    // Continues until: research is done, max iterations reached, or agent decides to ask user
    // =========================================================================
    const maxAutoIterations =
      researchMode === "steering"
        ? 1 // Steering mode: single iteration, always ask user
        : researchMode === "fully-autonomous"
          ? 20 // Fully autonomous: hard cap
          : parseInt(process.env.MAX_AUTO_ITERATIONS || "5"); // Semi-autonomous: configurable

    let iterationCount = 0;
    let shouldContinueLoop = true;

    // Variables that need to be accessible after the loop for reply generation
    let tasksToExecute: PlanTask[] = [];
    let hypothesisResult: { hypothesis: string; mode: string } = {
      hypothesis: "",
      mode: "create",
    };

    // Track the current message being updated (changes when auto-continuing)
    let currentMessage = createdMessage;

    // Flag to skip planning when continuing (tasks already promoted)
    let skipPlanning = false;

    // Track starting level for this user interaction (to gather all tasks across continuations)
    const sessionStartLevel = calculateSessionStartLevel(
      conversationState.values.currentLevel,
    );

    logger.info(
      { researchMode, maxAutoIterations },
      "starting_autonomous_research_loop",
    );

    while (shouldContinueLoop && iterationCount < maxAutoIterations) {
      iterationCount++;
      const iterationStartTime = Date.now();
      logger.info({ iterationCount, maxAutoIterations }, "starting_iteration");

      // Get current level - if skipPlanning, use existing; otherwise run planning agent
      let newLevel: number;
      let currentObjective: string;

      if (skipPlanning) {
        // CONTINUATION: Tasks already promoted, just get current level
        const currentPlan = conversationState.values.plan || [];
        newLevel =
          currentPlan.length > 0
            ? Math.max(...currentPlan.map((t) => t.level || 0))
            : 0;
        currentObjective = conversationState.values.currentObjective || "";
        skipPlanning = false; // Reset for next iteration

        logger.info(
          { newLevel, currentObjective },
          "continuation_using_promoted_tasks",
        );
      } else {
        // INITIAL: Execute planning agent
        logger.info(
          { suggestedNextSteps: conversationState.values.suggestedNextSteps },
          "current_suggested_next_steps",
        );

        const deepResearchPlanningResult = await planningAgent({
          state,
          conversationState,
          message: createdMessage,
          mode: "initial",
          usageType: "deep-research",
          researchMode,
        });

        const plan = deepResearchPlanningResult.plan;
        currentObjective = deepResearchPlanningResult.currentObjective;

        if (!plan || !currentObjective) {
          throw new Error("Plan or current objective not found");
        }

        // Clear previous suggestions since we're starting a new iteration
        conversationState.values.suggestedNextSteps = [];

        // Get current plan or initialize empty
        const currentPlan = conversationState.values.plan || [];

        // Find max level in current plan, default to -1 if empty
        const maxLevel =
          currentPlan?.length > 0
            ? Math.max(...currentPlan.map((t) => t.level || 0))
            : -1;

        // Add new tasks with appropriate level and assign IDs
        newLevel = maxLevel + 1;
        const newTasks = plan.map((task: PlanTask) => {
          const taskId =
            task.type === "ANALYSIS" ? `ana-${newLevel}` : `lit-${newLevel}`;
          return {
            ...task,
            id: taskId,
            level: newLevel,
            start: undefined,
            end: undefined,
            output: undefined,
          };
        });

        // Append to existing plan and update objective
        conversationState.values.plan = [...currentPlan, ...newTasks];
        conversationState.values.currentObjective = currentObjective;
        conversationState.values.currentLevel = newLevel; // Set current level for UI

        // Initialize main objective from first message (only if not already set)
        if (!conversationState.values.objective && createdMessage.question) {
          conversationState.values.objective = createdMessage.question;
        }

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
      }

      // Execute only tasks from the current level
      tasksToExecute = (conversationState.values.plan || []).filter(
        (t) => t.level === newLevel,
      );

      // Execute all tasks concurrently
      const taskPromises = tasksToExecute.map(async (task) => {
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

          const primaryLiteratureType =
            process.env.PRIMARY_LITERATURE_AGENT?.toUpperCase() === "BIO"
              ? "BIOLITDEEP"
              : "EDISON";

          // Build list of literature promises based on configured sources
          const literaturePromises: Promise<void>[] = [];

          // OpenScholar (enabled if OPENSCHOLAR_API_URL is configured)
          if (process.env.OPENSCHOLAR_API_URL) {
            const openScholarPromise = literatureAgent({
              objective: task.objective,
              type: "OPENSCHOLAR",
            }).then(async (result) => {
              if (result.count && result.count > 0) {
                task.output += `${result.output}\n\n`;
              }
              if (conversationState.id) {
                await updateConversationState(
                  conversationState.id,
                  conversationState.values,
                );
                logger.info({ count: result.count }, "openscholar_completed");
              }
              logger.info(
                { outputLength: result.output.length, count: result.count },
                "openscholar_result_received",
              );
            });
            literaturePromises.push(openScholarPromise);
          }

          // Primary literature (Edison or BioLit) - always enabled
          const primaryLiteraturePromise = literatureAgent({
            objective: task.objective,
            type: primaryLiteratureType,
          }).then(async (result) => {
            // Always append for Edison/BioLit (no count filtering)
            task.output += `${result.output}\n\n`;
            // Capture jobId from primary literature (Edison or BioLit)
            if (result.jobId) {
              task.jobId = result.jobId;
            }
            if (conversationState.id) {
              await updateConversationState(
                conversationState.id,
                conversationState.values,
              );
            }
            logger.info(
              { outputLength: result.output.length, jobId: result.jobId },
              "primary_literature_result_received",
            );
          });
          literaturePromises.push(primaryLiteraturePromise);

          // Knowledge base (enabled if KNOWLEDGE_DOCS_PATH is configured)
          if (process.env.KNOWLEDGE_DOCS_PATH) {
            const knowledgePromise = literatureAgent({
              objective: task.objective,
              type: "KNOWLEDGE",
            }).then(async (result) => {
              if (result.count && result.count > 0) {
                task.output += `${result.output}\n\n`;
              }
              if (conversationState.id) {
                await updateConversationState(
                  conversationState.id,
                  conversationState.values,
                );
                logger.info({ count: result.count }, "knowledge_completed");
              }
              logger.info(
                { outputLength: result.output.length, count: result.count },
                "knowledge_result_received",
              );
            });
            literaturePromises.push(knowledgePromise);
          }

          // Wait for all enabled sources to complete
          await Promise.all(literaturePromises);

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

            task.output = `${analysisResult.output}\n\n`;
            task.artifacts = analysisResult.artifacts || [];
            task.jobId = analysisResult.jobId;

            if (conversationState.id) {
              await updateConversationState(
                conversationState.id,
                conversationState.values,
              );
              logger.info(
                { jobId: analysisResult.jobId },
                "analysis_completed",
              );
            }

            logger.info(
              { outputLength: analysisResult.output.length },
              "analysis_result_received",
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error
                ? error.message
                : typeof error === "object" && error !== null
                  ? JSON.stringify(error)
                  : String(error);
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
      });

      // Wait for all tasks to complete
      await Promise.all(taskPromises);

      // Step 3: Generate/update hypothesis based on completed tasks
      logger.info("generating_hypothesis_from_completed_tasks");

      hypothesisResult = await hypothesisAgent({
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

      // Step 4: Run reflection and discovery agents in parallel
      logger.info("running_reflection_and_discovery_agents");

      // Determine if we should run discovery and which tasks to consider
      let shouldRunDiscovery = false;
      let tasksToConsider: PlanTask[] = [];

      if (createdMessage.conversation_id) {
        const allMessages = await getMessagesByConversation(
          createdMessage.conversation_id,
          100,
        );
        const messageCount = allMessages?.length || 1;

        const discoveryConfig = getDiscoveryRunConfig(
          messageCount,
          conversationState.values.plan || [],
          tasksToExecute,
        );

        shouldRunDiscovery = discoveryConfig.shouldRunDiscovery;
        tasksToConsider = discoveryConfig.tasksToConsider;
      }

      // Run reflection and discovery in parallel
      const [reflectionResult, discoveryResult] = await Promise.all([
        reflectionAgent({
          conversationState,
          message: createdMessage,
          completedMaxTasks: tasksToExecute, // MAX level tasks (current level)
          hypothesis: hypothesisResult.hypothesis,
        }),
        shouldRunDiscovery
          ? discoveryAgent({
              conversationState,
              message: createdMessage,
              tasksToConsider,
              hypothesis: hypothesisResult.hypothesis,
            })
          : Promise.resolve(null),
      ]);

      // Update conversation state with reflection results
      if (reflectionResult.objective) {
        // Only update main objective if reflection detected a fundamental direction change
        conversationState.values.objective = reflectionResult.objective;
      }
      conversationState.values.conversationTitle =
        reflectionResult.conversationTitle;
      conversationState.values.currentObjective =
        reflectionResult.currentObjective;
      conversationState.values.keyInsights = reflectionResult.keyInsights;
      conversationState.values.methodology = reflectionResult.methodology;

      // Update conversation state with discovery results if discovery ran
      if (discoveryResult) {
        conversationState.values.discoveries = discoveryResult.discoveries;
        logger.info(
          {
            discoveryCount: discoveryResult.discoveries.length,
          },
          "discoveries_updated",
        );
      }

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
        logger.info(
          {
            insights: reflectionResult.keyInsights,
            discoveries: conversationState.values.discoveries?.length || 0,
            currentObjective: reflectionResult.currentObjective,
          },
          "world_state_updated_via_reflection_and_discovery",
        );
      }

      // Step 5: Run planning agent in "next" mode to plan next iteration
      logger.info("running_next_planning_for_future_iteration");

      // Clear old suggestions before generating new ones (ensures fresh planning)
      conversationState.values.suggestedNextSteps = [];

      const nextPlanningResult = await planningAgent({
        state,
        conversationState,
        message: createdMessage,
        mode: "next",
        usageType: "deep-research",
        researchMode,
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
        // No suggested next steps means research is complete - exit loop
        shouldContinueLoop = false;
      }

      // =========================================================================
      // CONTINUE RESEARCH DECISION (before reply so we know if it's final)
      // Decide whether to continue autonomously or ask user for feedback
      // =========================================================================
      let isFinal = true;
      let willContinue = false;

      if (
        shouldContinueLoop &&
        conversationState.values.suggestedNextSteps?.length &&
        iterationCount < maxAutoIterations
      ) {
        const continueResult = await continueResearchAgent({
          conversationState,
          message: currentMessage,
          completedTasks: tasksToExecute,
          hypothesis: hypothesisResult.hypothesis,
          suggestedNextSteps: conversationState.values.suggestedNextSteps,
          iterationCount,
          researchMode,
        });

        logger.info(
          {
            shouldContinue: continueResult.shouldContinue,
            confidence: continueResult.confidence,
            reasoning: continueResult.reasoning,
            triggerReason: continueResult.triggerReason,
            iterationCount,
          },
          "continue_research_decision",
        );

        if (continueResult.shouldContinue) {
          isFinal = false;
          willContinue = true;
        } else {
          shouldContinueLoop = false;
          logger.info(
            { triggerReason: continueResult.triggerReason, iterationCount },
            "stopping_for_user_feedback",
          );
        }
      } else {
        // No suggested next steps - research complete, exit loop
        shouldContinueLoop = false;
      }

      // =========================================================================
      // GENERATE REPLY FOR THIS ITERATION
      // Each iteration gets its own reply, saved to the current message
      // =========================================================================
      logger.info(
        { iterationCount, messageId: currentMessage.id, isFinal },
        "generating_reply_for_iteration",
      );

      // Get completed tasks from this session, limited to last 3 levels max
      // This ensures reply covers work across continuations without overwhelming context
      const sessionCompletedTasks = getSessionCompletedTasks(
        conversationState.values.plan || [],
        sessionStartLevel,
        newLevel,
      );

      logger.info(
        {
          sessionCompletedTasksCount: sessionCompletedTasks.length,
          sessionStartLevel,
          newLevel,
          totalPlanTasks: (conversationState.values.plan || []).length,
        },
        "reply_tasks_filtered",
      );

      const replyResult = await replyAgent({
        conversationState,
        message: currentMessage,
        completedMaxTasks: sessionCompletedTasks,
        hypothesis: hypothesisResult.hypothesis,
        nextPlan: conversationState.values.suggestedNextSteps || [],
        isFinal,
      });

      // Update the current message with the reply and mark as complete
      const iterationResponseTime = Date.now() - iterationStartTime;
      await updateMessage(currentMessage.id, {
        content: replyResult.reply,
        summary: replyResult.summary,
        response_time: iterationResponseTime, // Mark message as complete so UI displays it
      });

      logger.info(
        {
          messageId: currentMessage.id,
          iterationCount,
          contentLength: replyResult.reply.length,
        },
        "iteration_reply_saved",
      );

      // Notify client that message is ready
      await notifyMessageUpdated(
        `in-process-${currentMessage.id}`,
        currentMessage.conversation_id,
        currentMessage.id,
      );

      // =========================================================================
      // PREPARE FOR NEXT ITERATION (if continuing)
      // =========================================================================
      if (willContinue) {
        // CONTINUE: Promote suggestedNextSteps to plan for next iteration
        skipPlanning = true; // Skip planning in next iteration - use promoted tasks

        logger.info({ iterationCount }, "auto_continuing_to_next_iteration");

        // Get current max level
        const currentPlan = conversationState.values.plan || [];
        const currentMaxLevel =
          currentPlan.length > 0
            ? Math.max(...currentPlan.map((t) => t.level || 0))
            : -1;
        const nextLevel = currentMaxLevel + 1;

        // Promote suggested steps to plan with new level and IDs
        const promotedTasks = conversationState.values.suggestedNextSteps.map(
          (task: PlanTask) => {
            const taskId =
              task.type === "ANALYSIS"
                ? `ana-${nextLevel}`
                : `lit-${nextLevel}`;
            return {
              ...task,
              id: taskId,
              level: nextLevel,
              start: undefined,
              end: undefined,
              output: undefined,
            };
          },
        );

        // Add to plan and clear suggestions
        conversationState.values.plan = [...currentPlan, ...promotedTasks];
        conversationState.values.suggestedNextSteps = [];
        conversationState.values.currentLevel = nextLevel;

        if (conversationState.id) {
          await updateConversationState(
            conversationState.id,
            conversationState.values,
          );
          logger.info(
            {
              nextLevel,
              promotedTaskCount: promotedTasks.length,
            },
            "suggested_steps_promoted_to_plan",
          );
        }

        // CREATE NEW AGENT-ONLY MESSAGE for the next iteration
        // This allows each autonomous iteration to have its own message in the conversation
        const agentMessage = await createContinuationMessage(
          currentMessage,
          stateRecord.id,
        );

        logger.info(
          {
            newMessageId: agentMessage.id,
            previousMessageId: currentMessage.id,
            iterationCount: iterationCount + 1,
          },
          "created_agent_continuation_message",
        );

        // Update currentMessage to point to the new message for next iteration
        currentMessage = agentMessage;
      }
    } // END OF WHILE LOOP

    // =========================================================================
    // END OF AUTONOMOUS LOOP
    // =========================================================================
    logger.info(
      { totalIterations: iterationCount, finalMessageId: currentMessage.id },
      "autonomous_loop_completed",
    );

    logger.info(
      {
        originalMessageId: createdMessage.id,
        finalMessageId: currentMessage.id,
        conversationId: createdMessage.conversation_id,
        totalIterations: iterationCount,
      },
      "deep_research_completed",
    );
  } catch (err) {
    logger.error(
      { err, messageId: createdMessage.id },
      "deep_research_execution_failed",
    );

    // Update state to mark as failed
    await updateState(stateRecord.id, {
      ...stateRecord.values,
      error: err instanceof Error ? err.message : "Unknown error",
      status: "failed",
    });
  }
}
