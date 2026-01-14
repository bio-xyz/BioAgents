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
import {
  createContinuationMessage,
  calculateSessionStartLevel,
  getSessionCompletedTasks,
} from "../../../utils/deep-research/continuation-utils";
import logger from "../../../utils/logger";

/**
 * Process a deep research job
 * This is the core deep research processing logic extracted from runDeepResearch
 *
 * Supports autonomous continuation:
 * - fullyAutonomous=false (default): Uses MAX_AUTO_ITERATIONS from env (default 5)
 * - fullyAutonomous=true: Continues until research is done or hard cap of 20 iterations
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
    fullyAutonomous = false,
  } = job.data;

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

    // =========================================================================
    // AUTONOMOUS ITERATION LOOP
    // Continues until: research is done, max iterations reached, or agent decides to ask user
    // =========================================================================
    const maxAutoIterations = fullyAutonomous
      ? 20 // Hard cap for fully autonomous mode
      : parseInt(process.env.MAX_AUTO_ITERATIONS || "5");

    let iterationCount = 0;
    let shouldContinueLoop = true;

    // Variables that need to be accessible after the loop
    let tasksToExecute: PlanTask[] = [];
    let hypothesisResult: { hypothesis: string; mode: string } = {
      hypothesis: "",
      mode: "create",
    };

    // Track the current message being updated (changes when auto-continuing)
    let currentMessage = messageRecord;

    // Flag to skip planning when continuing (tasks already promoted)
    let skipPlanning = false;

    // Track starting level for this user interaction (to gather all tasks across continuations)
    const sessionStartLevel = calculateSessionStartLevel(conversationState.values.currentLevel);

    logger.info(
      { jobId: job.id, fullyAutonomous, maxAutoIterations },
      "starting_autonomous_research_loop",
    );

    while (shouldContinueLoop && iterationCount < maxAutoIterations) {
      iterationCount++;
      logger.info(
        { jobId: job.id, iterationCount, maxAutoIterations },
        "starting_iteration",
      );

    // Update progress: Planning
    await job.updateProgress({ stage: "planning", percent: 5 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "planning", 5);

    // Get current level - if skipPlanning, use existing; otherwise run planning agent
    let newLevel: number;
    let currentObjective: string;

    if (skipPlanning) {
      // CONTINUATION: Tasks already promoted, just get current level
      const currentPlan = conversationState.values.plan || [];
      newLevel = currentPlan.length > 0
        ? Math.max(...currentPlan.map((t) => t.level || 0))
        : 0;
      currentObjective = conversationState.values.currentObjective || "";
      skipPlanning = false; // Reset for next iteration

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
      (t) => t.level === newLevel,
    );

    logger.info(
      {
        jobId: job.id,
        iterationCount,
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
        const primaryLiteratureLabel =
          primaryLiteratureType === "BIOLITDEEP" ? "BioLiterature" : "Edison";

        // Build list of literature promises based on configured sources
        const literaturePromises: Promise<void>[] = [];

        // OpenScholar (enabled if OPENSCHOLAR_API_URL is configured)
        if (process.env.OPENSCHOLAR_API_URL) {
          const openScholarPromise = literatureAgent({
            objective: task.objective,
            type: "OPENSCHOLAR",
          }).then(async (result) => {
            task.output += `OpenScholar literature results:\n${result.output}\n\n`;
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
          task.output += `${primaryLiteratureLabel} literature results:\n${result.output}\n\n`;
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
            task.output += `Knowledge literature results:\n${result.output}\n\n`;
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
    });

    if (nextPlanningResult.plan.length > 0) {
      conversationState.values.suggestedNextSteps = nextPlanningResult.plan;
      if (nextPlanningResult.currentObjective) {
        conversationState.values.currentObjective = nextPlanningResult.currentObjective;
      }
      if (conversationState.id) {
        await updateConversationState(conversationState.id, conversationState.values);
      }
    } else {
      // No suggested next steps means research is complete - exit loop
      shouldContinueLoop = false;
    }

    // =========================================================================
    // CONTINUE RESEARCH DECISION (before reply so we know if it's final)
    // Decide whether to continue autonomously or ask user for feedback
    // =========================================================================
    let isFinal = true;
    let willContinue = false;

    if (shouldContinueLoop && conversationState.values.suggestedNextSteps?.length) {
      const { continueResearchAgent } = await import(
        "../../../agents/continueResearch"
      );

      const continueResult = await continueResearchAgent({
        conversationState,
        message: currentMessage,
        completedTasks: tasksToExecute,
        hypothesis: hypothesisResult.hypothesis,
        suggestedNextSteps: conversationState.values.suggestedNextSteps,
        iterationCount,
        fullyAutonomous,
      });

      logger.info(
        {
          jobId: job.id,
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
          { jobId: job.id, triggerReason: continueResult.triggerReason, iterationCount },
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
    await job.updateProgress({ stage: "reply", percent: 95 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 95);

    logger.info(
      { jobId: job.id, iterationCount, messageId: currentMessage.id, isFinal },
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
          iterationCount,
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
        iterationCount,
        contentLength: replyResult.reply?.length || 0,
      },
      "iteration_reply_saved",
    );

    // Notify message updated
    await notifyMessageUpdated(job.id!, conversationId, currentMessage.id);

    // =========================================================================
    // PREPARE FOR NEXT ITERATION (if continuing)
    // =========================================================================
    if (willContinue) {
      // CONTINUE: Promote suggestedNextSteps to plan for next iteration
      skipPlanning = true; // Skip planning in next iteration - use promoted tasks

      logger.info(
        { jobId: job.id, iterationCount },
        "auto_continuing_to_next_iteration",
      );

      // Get current max level
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
    const responseTime = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        originalMessageId: messageId,
        finalMessageId: currentMessage.id,
        totalIterations: iterationCount,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "deep_research_job_completed",
    );

    // Notify: Job completed
    await notifyJobCompleted(job.id!, conversationId, currentMessage.id, stateId);

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
      // Deep research with autonomous mode can take 2-8 hours
      // lockRenewTime must be significantly less than lockDuration (1/6 ratio)
      lockDuration: 3600000, // 1 hour - gives plenty of buffer before stalled detection
      lockRenewTime: 600000, // 10 minutes - renew well before lock expires
      stalledInterval: 1800000, // 30 minutes - check for stalled jobs
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
