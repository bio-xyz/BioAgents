/**
 * Deep Research Worker for BullMQ
 *
 * Architecture: Iteration-per-job
 * Each job executes exactly ONE iteration of the deep research workflow.
 * If the research should continue, the worker enqueues the next iteration
 * as a new job. This provides:
 * - Atomic iterations (either fully complete or never started)
 * - Better graceful shutdown (each job ~5-10 min instead of 20+ min)
 * - Natural retry on failure (no partial state to rollback)
 * - Better scaling (different workers can handle different iterations)
 */

import { Worker, Job } from "bullmq";
import { getBullMQConnection } from "../connection";
import {
  notifyJobStarted,
  notifyJobProgress,
  notifyJobCompleted,
  notifyJobFailed,
  notifyMessageUpdated,
  notifyStateUpdated,
} from "../notify";
import { getDeepResearchQueue } from "../queues";
import type { DeepResearchJobData, DeepResearchJobResult, JobProgress } from "../types";
import type { ConversationState, PlanTask, State } from "../../../types/core";
import {
  createContinuationMessage,
  calculateSessionStartLevel,
  getSessionCompletedTasks,
} from "../../../utils/deep-research/continuation-utils";
import logger from "../../../utils/logger";

/**
 * Process a deep research job - executes a SINGLE iteration
 *
 * Research modes:
 * - 'semi-autonomous' (default): Uses MAX_AUTO_ITERATIONS from env (default 5)
 * - 'fully-autonomous': Continues until research is done or hard cap of 20 iterations
 * - 'steering': Single iteration only, always asks user for feedback
 */
async function processDeepResearchJob(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
): Promise<DeepResearchJobResult> {
  const startTime = Date.now();
  const {
    userId,
    conversationId,
    messageId,
    stateId,
    conversationStateId,
    message,
    researchMode: requestedResearchMode,
    iterationNumber = 1,
    rootJobId,
    isInitialIteration = true,
  } = job.data;

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn(
      {
        jobId: job.id,
        messageId,
        iterationNumber,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
      },
      "deep_research_job_retry_attempt",
    );
  }

  logger.info(
    {
      jobId: job.id,
      messageId,
      conversationId,
      conversationStateId,
      stateId,
      userId,
      requestedResearchMode,
      iterationNumber,
      rootJobId: rootJobId || job.id,
      isInitialIteration,
      messagePreview: message ? (message.length > 200 ? message.substring(0, 200) + "..." : message) : undefined,
      messageLength: message?.length,
    },
    "deep_research_job_started",
  );

  // Notify: Job started
  await notifyJobStarted(job.id!, conversationId, messageId, stateId);

  try {
    // Import required modules
    const {
      getMessage,
      getState,
      getConversationState,
      updateConversationState,
      updateMessage,
      updateState,
    } = await import("../../../db/operations");

    // Get message record
    const messageRecord = await getMessage(messageId);
    if (!messageRecord) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Get state record
    const stateRecord = await getState(stateId);
    if (!stateRecord) {
      throw new Error(`State not found: ${stateId}`);
    }

    // Get conversation state
    const conversationStateRecord = await getConversationState(conversationStateId);
    if (!conversationStateRecord) {
      throw new Error(`Conversation state not found: ${conversationStateId}`);
    }

    // Initialize state objects
    const state: State = {
      id: stateRecord.id,
      values: {
        ...stateRecord.values,
        isDeepResearch: true,
      },
    };

    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    // Reconcile researchMode: request takes priority, then existing state, then default
    type ResearchMode = "semi-autonomous" | "fully-autonomous" | "steering";
    const researchMode: ResearchMode = requestedResearchMode
      || conversationState.values.researchMode
      || "semi-autonomous";

    // Save researchMode to conversation state (allows it to change per request)
    conversationState.values.researchMode = researchMode;

    // Calculate max iterations based on mode
    const maxAutoIterations =
      researchMode === "steering"
        ? 1 // Steering mode: single iteration, always ask user
        : researchMode === "fully-autonomous"
          ? 20 // Fully autonomous: hard cap
          : parseInt(process.env.MAX_AUTO_ITERATIONS || "5"); // Semi-autonomous: configurable

    // Variables for this iteration
    let tasksToExecute: PlanTask[] = [];
    let hypothesisResult: { hypothesis: string; mode: string } = {
      hypothesis: "",
      mode: "create",
    };

    // Track the current message being updated
    let currentMessage = messageRecord;

    // Track starting level for this user interaction (to gather all tasks across continuations)
    const sessionStartLevel = calculateSessionStartLevel(conversationState.values.currentLevel);

    logger.info(
      { jobId: job.id, researchMode, maxAutoIterations, iterationNumber, isInitialIteration },
      "starting_iteration",
    );

    // =========================================================================
    // SINGLE ITERATION EXECUTION
    // =========================================================================

    // Update progress: Planning
    await job.updateProgress({ stage: "planning", percent: 5 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "planning", 5);

    // Get current level - if continuation, use existing; otherwise run planning agent
    let newLevel: number;
    let currentObjective: string;

    if (!isInitialIteration) {
      // CONTINUATION: Tasks already promoted, just get current level
      const currentPlan = conversationState.values.plan || [];
      newLevel = currentPlan.length > 0
        ? Math.max(...currentPlan.map((t) => t.level || 0))
        : 0;
      currentObjective = conversationState.values.currentObjective || "";

      logger.info(
        { jobId: job.id, newLevel, currentObjective },
        "continuation_using_promoted_tasks",
      );
    } else {
      // INITIAL: Execute planning agent
      logger.info({ jobId: job.id }, "deep_research_job_planning");

      const { planningAgent } = await import("../../../agents/planning");

      const planningResult = await planningAgent({
        state,
        conversationState,
        message: messageRecord,
        mode: "initial",
        usageType: "deep-research",
        researchMode,
      });

      const plan = planningResult.plan;
      currentObjective = planningResult.currentObjective;

      if (!plan || !currentObjective) {
        throw new Error("Plan or current objective not found");
      }

      // Clear previous suggestions
      conversationState.values.suggestedNextSteps = [];

      // Get current plan or initialize empty
      const currentPlan = conversationState.values.plan || [];

      // Find max level in current plan
      const maxLevel =
        currentPlan?.length > 0
          ? Math.max(...currentPlan.map((t) => t.level || 0))
          : -1;

      // Add new tasks with appropriate level and assign IDs
      newLevel = maxLevel + 1;
      const newTasks = plan.map((task: PlanTask) => {
        const taskId = task.type === "ANALYSIS" ? `ana-${newLevel}` : `lit-${newLevel}`;
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
      conversationState.values.currentLevel = newLevel;

      // Initialize main objective from first message (only if not already set)
      if (!conversationState.values.objective && messageRecord.question) {
        conversationState.values.objective = messageRecord.question;
      }

      // Update state in DB
      if (conversationState.id) {
        await updateConversationState(conversationState.id, conversationState.values);
        await notifyStateUpdated(job.id!, conversationId, conversationState.id);
      }

      logger.info(
        { jobId: job.id, newLevel, taskCount: newTasks.length },
        "deep_research_job_planning_completed",
      );
    }

    // Update progress: Literature/Analysis
    await job.updateProgress({ stage: "literature", percent: 20 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "literature", 20);

    // Step 2: Execute tasks
    const { literatureAgent } = await import("../../../agents/literature");
    const { analysisAgent } = await import("../../../agents/analysis");

    tasksToExecute = (conversationState.values.plan || []).filter(
      (t) => t.level === newLevel && !t.end, // Skip already-completed tasks (for retry safety)
    );

    logger.info(
      {
        jobId: job.id,
        iterationNumber,
        newLevel,
        tasksToExecuteCount: tasksToExecute.length,
        taskIds: tasksToExecute.map((t) => t.id),
        allPlanLevels: [...new Set((conversationState.values.plan || []).map((t) => t.level))],
      },
      "tasks_to_execute_for_iteration",
    );

    // Execute all tasks concurrently
    const taskPromises = tasksToExecute.map(async (task) => {
      if (task.type === "LITERATURE") {
        task.start = new Date().toISOString();
        task.output = "";

        if (conversationState.id) {
          await updateConversationState(conversationState.id, conversationState.values);
        }

        logger.info(
          { jobId: job.id, taskObjective: task.objective },
          "deep_research_job_executing_literature_task",
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
            task.output += `${result.output}\n\n`;
            if (conversationState.id) {
              await updateConversationState(conversationState.id, conversationState.values);
            }
          });
          literaturePromises.push(openScholarPromise);
        }

        // Primary literature (Edison or BioLit) - always enabled
        const primaryLiteraturePromise = literatureAgent({
          objective: task.objective,
          type: primaryLiteratureType,
        }).then(async (result) => {
          task.output += `${result.output}\n\n`;
          // Capture jobId from primary literature (Edison)
          if (result.jobId) {
            task.jobId = result.jobId;
          }
          if (conversationState.id) {
            await updateConversationState(conversationState.id, conversationState.values);
          }
        });
        literaturePromises.push(primaryLiteraturePromise);

        // Knowledge base (enabled if KNOWLEDGE_DOCS_PATH is configured)
        if (process.env.KNOWLEDGE_DOCS_PATH) {
          const knowledgePromise = literatureAgent({
            objective: task.objective,
            type: "KNOWLEDGE",
          }).then(async (result) => {
            task.output += `${result.output}\n\n`;
            if (conversationState.id) {
              await updateConversationState(conversationState.id, conversationState.values);
            }
          });
          literaturePromises.push(knowledgePromise);
        }

        await Promise.all(literaturePromises);

        task.end = new Date().toISOString();
        if (conversationState.id) {
          await updateConversationState(conversationState.id, conversationState.values);
          await notifyStateUpdated(job.id!, conversationId, conversationState.id);
        }
      } else if (task.type === "ANALYSIS") {
        // Update progress for analysis
        await job.updateProgress({ stage: "analysis", percent: 50 } as JobProgress);
        await notifyJobProgress(job.id!, conversationId, "analysis", 50);

        task.start = new Date().toISOString();
        task.output = "";

        if (conversationState.id) {
          await updateConversationState(conversationState.id, conversationState.values);
        }

        logger.info(
          { jobId: job.id, taskObjective: task.objective, datasets: task.datasets },
          "deep_research_job_executing_analysis_task",
        );

        try {
          const type =
            process.env.PRIMARY_ANALYSIS_AGENT?.toUpperCase() === "BIO"
              ? "BIO"
              : "EDISON";

          const analysisResult = await analysisAgent({
            objective: task.objective,
            datasets: task.datasets,
            type,
            userId: messageRecord.user_id,
            conversationStateId: conversationState.id!,
          });

          task.output = `${analysisResult.output}\n\n`;
          task.artifacts = analysisResult.artifacts || [];
          task.jobId = analysisResult.jobId;

          if (conversationState.id) {
            await updateConversationState(conversationState.id, conversationState.values);
          }
        } catch (error) {
          const errorMsg = error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null
              ? JSON.stringify(error)
              : String(error);
          task.output = `Analysis failed: ${errorMsg}`;
          logger.error(
            { error, jobId: job.id, taskObjective: task.objective },
            "deep_research_job_analysis_failed",
          );
        }

        task.end = new Date().toISOString();
        if (conversationState.id) {
          await updateConversationState(conversationState.id, conversationState.values);
          await notifyStateUpdated(job.id!, conversationId, conversationState.id);
        }
      }
    });

    // Wait for all tasks to complete
    await Promise.all(taskPromises);

    logger.info(
      { jobId: job.id, completedTasksCount: tasksToExecute.length },
      "deep_research_job_tasks_completed",
    );

    // Update progress: Hypothesis
    await job.updateProgress({ stage: "hypothesis", percent: 70 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "hypothesis", 70);

    // Step 3: Generate hypothesis
    logger.info({ jobId: job.id }, "deep_research_job_generating_hypothesis");

    const { hypothesisAgent } = await import("../../../agents/hypothesis");

    hypothesisResult = await hypothesisAgent({
      objective: currentObjective,
      message: messageRecord,
      conversationState,
      completedTasks: tasksToExecute,
    });

    conversationState.values.currentHypothesis = hypothesisResult.hypothesis;
    if (conversationState.id) {
      await updateConversationState(conversationState.id, conversationState.values);
    }

    // Update progress: Reflection
    await job.updateProgress({ stage: "reflection", percent: 85 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reflection", 85);

    // Step 4: Run reflection and discovery agents in parallel
    logger.info({ jobId: job.id }, "deep_research_job_reflection_and_discovery");

    const { reflectionAgent } = await import("../../../agents/reflection");
    const { discoveryAgent } = await import("../../../agents/discovery");
    const { getMessagesByConversation } = await import("../../../db/operations");
    const { getDiscoveryRunConfig } = await import("../../../utils/discovery");

    // Determine if we should run discovery and which tasks to consider
    let shouldRunDiscovery = false;
    let tasksToConsider: PlanTask[] = [];

    if (messageRecord.conversation_id) {
      const allMessages = await getMessagesByConversation(
        messageRecord.conversation_id,
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
        message: messageRecord,
        completedMaxTasks: tasksToExecute,
        hypothesis: hypothesisResult.hypothesis,
      }),
      shouldRunDiscovery
        ? discoveryAgent({
            conversationState,
            message: messageRecord,
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
    conversationState.values.conversationTitle = reflectionResult.conversationTitle;
    conversationState.values.currentObjective = reflectionResult.currentObjective;
    conversationState.values.keyInsights = reflectionResult.keyInsights;
    conversationState.values.methodology = reflectionResult.methodology;

    // Update conversation state with discovery results if discovery ran
    if (discoveryResult) {
      conversationState.values.discoveries = discoveryResult.discoveries;
      logger.info(
        { jobId: job.id, discoveryCount: discoveryResult.discoveries.length },
        "discoveries_updated",
      );
    }

    if (conversationState.id) {
      await updateConversationState(conversationState.id, conversationState.values);
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }

    // Step 5: Plan next iteration
    logger.info({ jobId: job.id }, "deep_research_job_planning_next");

    const { planningAgent } = await import("../../../agents/planning");
    const nextPlanningResult = await planningAgent({
      state,
      conversationState,
      message: messageRecord,
      mode: "next",
      usageType: "deep-research",
      researchMode,
    });

    // Track whether research should continue
    let shouldContinue = false;

    if (nextPlanningResult.plan.length > 0) {
      conversationState.values.suggestedNextSteps = nextPlanningResult.plan;
      if (nextPlanningResult.currentObjective) {
        conversationState.values.currentObjective = nextPlanningResult.currentObjective;
      }
      if (conversationState.id) {
        await updateConversationState(conversationState.id, conversationState.values);
      }
      shouldContinue = true;
    }

    // =========================================================================
    // CONTINUE RESEARCH DECISION (before reply so we know if it's final)
    // Decide whether to continue autonomously or ask user for feedback
    // =========================================================================
    let isFinal = true;
    let willContinue = false;

    if (shouldContinue && conversationState.values.suggestedNextSteps?.length && iterationNumber < maxAutoIterations) {
      const { continueResearchAgent } = await import(
        "../../../agents/continueResearch"
      );

      const continueResult = await continueResearchAgent({
        conversationState,
        message: currentMessage,
        completedTasks: tasksToExecute,
        hypothesis: hypothesisResult.hypothesis,
        suggestedNextSteps: conversationState.values.suggestedNextSteps,
        iterationCount: iterationNumber,
        researchMode,
      });

      logger.info(
        {
          jobId: job.id,
          shouldContinue: continueResult.shouldContinue,
          confidence: continueResult.confidence,
          reasoning: continueResult.reasoning,
          triggerReason: continueResult.triggerReason,
          iterationNumber,
        },
        "continue_research_decision",
      );

      if (continueResult.shouldContinue) {
        isFinal = false;
        willContinue = true;
      } else {
        logger.info(
          { jobId: job.id, triggerReason: continueResult.triggerReason, iterationNumber },
          "stopping_for_user_feedback",
        );
      }
    }

    // =========================================================================
    // GENERATE REPLY FOR THIS ITERATION
    // =========================================================================
    await job.updateProgress({ stage: "reply", percent: 95 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 95);

    logger.info(
      { jobId: job.id, iterationNumber, messageId: currentMessage.id, isFinal },
      "generating_reply_for_iteration",
    );

    const { replyAgent } = await import("../../../agents/reply");

    // Get completed tasks from this session, limited to last 3 levels max
    // This ensures reply covers work across continuations without overwhelming context
    const sessionCompletedTasks = getSessionCompletedTasks(
      conversationState.values.plan || [],
      sessionStartLevel,
      newLevel,
    );

    logger.info(
      {
        jobId: job.id,
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

    // Warn if reply is empty
    if (!replyResult.reply || replyResult.reply.trim().length === 0) {
      logger.warn(
        {
          jobId: job.id,
          messageId: currentMessage.id,
          iterationNumber,
          replyResult,
        },
        "reply_agent_returned_empty_response",
      );
    }

    // Update the current message with the reply and mark as complete
    const iterationResponseTime = Date.now() - startTime;
    await updateMessage(currentMessage.id, {
      content: replyResult.reply,
      summary: replyResult.summary,
      response_time: iterationResponseTime, // Mark message as complete so UI displays it
    });

    logger.info(
      {
        jobId: job.id,
        messageId: currentMessage.id,
        iterationNumber,
        contentLength: replyResult.reply?.length || 0,
      },
      "iteration_reply_saved",
    );

    // Notify message updated
    await notifyMessageUpdated(job.id!, conversationId, currentMessage.id);

    // =========================================================================
    // ENQUEUE NEXT ITERATION (if continuing)
    // This is the key change: instead of looping, we enqueue a new job
    // =========================================================================
    if (willContinue) {
      logger.info(
        { jobId: job.id, iterationNumber },
        "preparing_next_iteration_job",
      );

      // Promote suggestedNextSteps to plan for next iteration
      const currentPlan = conversationState.values.plan || [];
      const currentMaxLevel =
        currentPlan.length > 0
          ? Math.max(...currentPlan.map((t) => t.level || 0))
          : -1;
      const nextLevel = currentMaxLevel + 1;

      // Promote suggested steps to plan with new level and IDs
      const promotedTasks = (conversationState.values.suggestedNextSteps || []).map(
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
            jobId: job.id,
            nextLevel,
            promotedTaskCount: promotedTasks.length,
          },
          "suggested_steps_promoted_to_plan",
        );
      }

      // CREATE NEW AGENT-ONLY MESSAGE for the next iteration
      const agentMessage = await createContinuationMessage(
        currentMessage,
        stateId,
      );

      logger.info(
        {
          jobId: job.id,
          newMessageId: agentMessage.id,
          previousMessageId: currentMessage.id,
          nextIterationNumber: iterationNumber + 1,
        },
        "created_agent_continuation_message",
      );

      // ENQUEUE NEXT ITERATION JOB
      const queue = getDeepResearchQueue();
      const nextMessageId = agentMessage.id!; // createMessage always returns an ID
      const nextJobName = `iteration-${iterationNumber + 1}-${nextMessageId}`;

      await queue.add(
        nextJobName,
        {
          userId,
          conversationId,
          messageId: nextMessageId, // Next iteration writes to new message
          message, // Original message for context
          authMethod: job.data.authMethod,
          stateId,
          conversationStateId,
          requestedAt: new Date().toISOString(),
          researchMode,
          iterationNumber: iterationNumber + 1,
          rootJobId: rootJobId || job.id!, // Track the chain back to original
          isInitialIteration: false, // Use promoted tasks, skip planning
        },
        {
          jobId: nextMessageId, // Use message ID as job ID for easy lookup
        },
      );

      logger.info(
        {
          jobId: job.id,
          nextJobName,
          nextIterationNumber: iterationNumber + 1,
          nextMessageId,
          rootJobId: rootJobId || job.id,
        },
        "enqueued_next_iteration_job",
      );
    }

    // =========================================================================
    // JOB COMPLETE
    // =========================================================================
    const responseTime = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        messageId: currentMessage.id,
        iterationNumber,
        willContinue,
        isFinal,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "deep_research_job_completed",
    );

    // Notify: Job completed
    await notifyJobCompleted(job.id!, conversationId, currentMessage.id, stateId);

    // Complete credits when research is truly done (final iteration)
    if (isFinal) {
      try {
        const { getServiceClient } = await import("../../../db/client");
        const supabase = getServiceClient();

        // Look up Privy ID from database user ID (credits are keyed by Privy ID)
        const { data: userData } = await supabase
          .from('users')
          .select('user_id')
          .eq('id', userId)
          .single();

        const privyId = userData?.user_id;
        if (!privyId) {
          logger.warn({ userId }, "credit_completion_skipped_no_privy_id");
        } else {
          const { data, error } = await supabase.rpc('complete_deep_research_job', {
            p_user_id: privyId,
            p_job_id: job.data.rootJobId || job.id,
            p_final_iterations: iterationNumber,
          });

          if (error) {
            logger.error({ error, privyId }, "credit_completion_failed");
          } else {
            logger.info({ refunded: data?.refunded, iterations: iterationNumber, privyId }, "credits_completed");
          }
        }
      } catch (err) {
        logger.error({ err }, "credit_completion_error");
      }
    }

    return {
      messageId: currentMessage.id,
      status: "completed",
      responseTime,
    };
  } catch (error) {
    logger.error(
      {
        jobId: job.id,
        error,
        iterationNumber,
        attempt: job.attemptsMade + 1,
        willRetry: job.attemptsMade + 1 < (job.opts.attempts || 2),
      },
      "deep_research_job_failed",
    );

    // Update state to mark as failed (only on final attempt)
    if (job.attemptsMade + 1 >= (job.opts.attempts || 2)) {
      try {
        const { updateState } = await import("../../../db/operations");
        await updateState(stateId, {
          error: error instanceof Error ? error.message : "Unknown error",
          status: "failed",
        });

        // Notify: Job failed
        await notifyJobFailed(job.id!, conversationId, messageId, stateId);

        // Refund credits on final failure
        const { getServiceClient } = await import("../../../db/client");
        const supabase = getServiceClient();

        // Look up Privy ID from database user ID (credits are keyed by Privy ID)
        const { data: userData } = await supabase
          .from('users')
          .select('user_id')
          .eq('id', userId)
          .single();

        const privyId = userData?.user_id;
        if (!privyId) {
          logger.warn({ userId }, "credit_refund_skipped_no_privy_id");
        } else {
          const { data, error: refundError } = await supabase.rpc('refund_deep_research_credits', {
            p_user_id: privyId,
            p_job_id: job.data.rootJobId || job.id,
          });

          if (refundError) {
            logger.error({ refundError, privyId }, "credit_refund_failed");
          } else {
            logger.info({ refunded: data?.refunded, privyId }, "credits_refunded_on_failure");
          }
        }
      } catch (updateErr) {
        logger.error({ updateErr }, "failed_to_update_state_on_error");
      }
    }

    // Re-throw to trigger retry (if attempts remaining)
    throw error;
  }
}

/**
 * Start the deep research worker
 */
export function startDeepResearchWorker(): Worker {
  const concurrency = parseInt(process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || "3");

  const worker = new Worker<DeepResearchJobData, DeepResearchJobResult>(
    "deep-research",
    processDeepResearchJob,
    {
      connection: getBullMQConnection(),
      concurrency,
      // Deep research with autonomous mode can take 2-8 hours
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 1800000,   // 30 minutes - covers most iterations including slow analysis
      lockRenewTime: 300000,   // 5 minutes - renew frequently (6x before expiry)
      stalledInterval: 600000, // 10 minutes - detect stalled jobs reasonably fast
    },
  );

  worker.on("completed", (job, result) => {
    logger.info(
      {
        jobId: job.id,
        messageId: result.messageId,
        responseTime: result.responseTime,
        iterationNumber: job.data.iterationNumber,
      },
      "deep_research_worker_job_completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
        iterationNumber: job?.data.iterationNumber,
      },
      "deep_research_worker_job_failed_permanently",
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "deep_research_worker_job_stalled");
  });

  logger.info({ concurrency }, "deep_research_worker_started");

  return worker;
}
