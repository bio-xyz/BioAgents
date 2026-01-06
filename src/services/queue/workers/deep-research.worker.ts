/**
 * Deep Research Worker for BullMQ
 *
 * Processes deep research jobs from the queue.
 * This is the same logic as runDeepResearch in routes/deep-research/start.ts,
 * but extracted to run in a separate worker process.
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
import type { DeepResearchJobData, DeepResearchJobResult, JobProgress } from "../types";
import type { ConversationState, PlanTask, State } from "../../../types/core";
import logger from "../../../utils/logger";

/**
 * Process a deep research job
 * This is the core deep research processing logic extracted from runDeepResearch
 */
async function processDeepResearchJob(
  job: Job<DeepResearchJobData, DeepResearchJobResult>,
): Promise<DeepResearchJobResult> {
  const startTime = Date.now();
  const { userId, conversationId, messageId, stateId, conversationStateId } = job.data;

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn(
      {
        jobId: job.id,
        messageId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
      },
      "deep_research_job_retry_attempt",
    );
  }

  logger.info(
    { jobId: job.id, messageId, conversationId },
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

    // Update progress: Planning
    await job.updateProgress({ stage: "planning", percent: 5 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "planning", 5);

    // Step 1: Execute planning agent
    logger.info({ jobId: job.id }, "deep_research_job_planning");

    const { planningAgent } = await import("../../../agents/planning");

    const planningResult = await planningAgent({
      state,
      conversationState,
      message: messageRecord,
      mode: "initial",
    });

    const plan = planningResult.plan;
    const currentObjective = planningResult.currentObjective;

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
    const newLevel = maxLevel + 1;
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

    // Update state in DB
    if (conversationState.id) {
      await updateConversationState(conversationState.id, conversationState.values);
      await notifyStateUpdated(job.id!, conversationId, conversationState.id);
    }

    logger.info(
      { jobId: job.id, newLevel, taskCount: newTasks.length },
      "deep_research_job_planning_completed",
    );

    // Update progress: Literature/Analysis
    await job.updateProgress({ stage: "literature", percent: 20 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "literature", 20);

    // Step 2: Execute tasks
    const { literatureAgent } = await import("../../../agents/literature");
    const { analysisAgent } = await import("../../../agents/analysis");

    const tasksToExecute = conversationState.values.plan.filter(
      (t) => t.level === newLevel,
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
        const primaryLiteratureLabel =
          primaryLiteratureType === "BIOLITDEEP" ? "BioLiterature" : "Edison";

        // Run literature searches in parallel
        const openScholarPromise = literatureAgent({
          objective: task.objective,
          type: "OPENSCHOLAR",
        }).then(async (result) => {
          task.output += `OpenScholar literature results:\n${result.output}\n\n`;
          if (conversationState.id) {
            await updateConversationState(conversationState.id, conversationState.values);
          }
        });

        const primaryLiteraturePromise = literatureAgent({
          objective: task.objective,
          type: primaryLiteratureType,
        }).then(async (result) => {
          task.output += `${primaryLiteratureLabel} literature results:\n${result.output}\n\n`;
          // Capture jobId from primary literature (Edison)
          if (result.jobId) {
            task.jobId = result.jobId;
          }
          if (conversationState.id) {
            await updateConversationState(conversationState.id, conversationState.values);
          }
        });

        const knowledgePromise = literatureAgent({
          objective: task.objective,
          type: "KNOWLEDGE",
        }).then(async (result) => {
          task.output += `Knowledge literature results:\n${result.output}\n\n`;
          if (conversationState.id) {
            await updateConversationState(conversationState.id, conversationState.values);
          }
        });

        await Promise.all([openScholarPromise, primaryLiteraturePromise, knowledgePromise]);

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

          task.output = `Analysis results:\n${analysisResult.output}\n\n`;
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

    const hypothesisResult = await hypothesisAgent({
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

    const nextPlanningResult = await planningAgent({
      state,
      conversationState,
      message: messageRecord,
      mode: "next",
    });

    if (nextPlanningResult.plan.length > 0) {
      conversationState.values.suggestedNextSteps = nextPlanningResult.plan;
      if (nextPlanningResult.currentObjective) {
        conversationState.values.currentObjective = nextPlanningResult.currentObjective;
      }
      if (conversationState.id) {
        await updateConversationState(conversationState.id, conversationState.values);
      }
    }

    // Update progress: Reply
    await job.updateProgress({ stage: "reply", percent: 95 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 95);

    // Step 6: Generate reply
    logger.info({ jobId: job.id }, "deep_research_job_generating_reply");

    const { replyAgent } = await import("../../../agents/reply");

    const replyResult = await replyAgent({
      conversationState,
      message: messageRecord,
      completedMaxTasks: tasksToExecute,
      hypothesis: hypothesisResult.hypothesis,
      nextPlan: conversationState.values.suggestedNextSteps || [],
    });

    // Save reply to message
    await updateMessage(messageId, { content: replyResult.reply });

    // Notify message updated
    await notifyMessageUpdated(job.id!, conversationId, messageId);

    const responseTime = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        messageId,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "deep_research_job_completed",
    );

    // Notify: Job completed
    await notifyJobCompleted(job.id!, conversationId, messageId, stateId);

    return {
      messageId,
      status: "completed",
      responseTime,
    };
  } catch (error) {
    logger.error(
      {
        jobId: job.id,
        error,
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
      // Deep research can take 20-30+ minutes
      lockDuration: 1800000, // 30 minutes
      stalledInterval: 60000, // Check stalled jobs every 1 minute
      lockRenewTime: 900000, // Renew lock every 15 minutes
    },
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, messageId: result.messageId, responseTime: result.responseTime },
      "deep_research_worker_job_completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
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
