/**
 * Chat Worker for BullMQ
 *
 * Processes chat jobs from the queue.
 * This is the same logic as chatHandler in routes/chat.ts,
 * but extracted to run in a separate worker process.
 */

import { Job, Worker } from "bullmq";
import type { ConversationState, PlanTask, State } from "../../../types/core";
import logger from "../../../utils/logger";
import { getBullMQConnection } from "../connection";
import {
  notifyJobCompleted,
  notifyJobFailed,
  notifyJobProgress,
  notifyJobStarted,
  notifyMessageUpdated,
} from "../notify";
import type { ChatJobData, ChatJobResult, JobProgress } from "../types";

/**
 * Process a chat job
 * This is the core chat processing logic extracted from chatHandler
 */
async function processChatJob(
  job: Job<ChatJobData, ChatJobResult>,
): Promise<ChatJobResult> {
  const startTime = Date.now();
  const { userId, conversationId, messageId, message } = job.data;

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn(
      {
        jobId: job.id,
        messageId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
      },
      "chat_job_retry_attempt",
    );
  }

  logger.info({ jobId: job.id, messageId, conversationId }, "chat_job_started");

  // Notify: Job started
  await notifyJobStarted(job.id!, conversationId, messageId);

  try {
    // Import required modules
    const {
      getMessage,
      getState,
      getConversationState,
      updateConversationState,
      updateMessage,
    } = await import("../../../db/operations");
    const { updateMessageResponseTime } = await import("../../chat/tools");

    // Get message record (already created by route handler)
    const messageRecord = await getMessage(messageId);
    if (!messageRecord) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Get state record
    const stateRecord = await getState(messageRecord.state_id);
    if (!stateRecord) {
      throw new Error(`State not found for message: ${messageId}`);
    }

    // Get conversation state
    const { getConversation } = await import("../../../db/operations");
    const conversation = await getConversation(conversationId);
    const conversationStateRecord = await getConversationState(
      conversation.conversation_state_id,
    );

    // Initialize state objects
    const state: State = {
      id: stateRecord.id,
      values: stateRecord.values,
    };

    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    // Wait for any pending file processing jobs BEFORE planning
    // This ensures files uploaded with the chat message are available
    const { getPendingFileIds, getFileStatus } =
      await import("../../files/status");
    const { getFileProcessQueue } = await import("../queues");

    const conversationStateId = conversationState.id;
    if (conversationStateId) {
      const pendingFileIds = await getPendingFileIds(conversationStateId);

      if (pendingFileIds.length > 0) {
        logger.info(
          { jobId: job.id, pendingFileIds, conversationStateId },
          "chat_job_waiting_for_file_processing",
        );

        const fileProcessQueue = getFileProcessQueue();
        const maxWaitMs = 120000; // 2 minute max wait
        const pollIntervalMs = 500;
        const startWait = Date.now();

        // Wait for all pending files to complete
        for (const fileId of pendingFileIds) {
          while (Date.now() - startWait < maxWaitMs) {
            // Check if file-process job completed
            const fileJob = await fileProcessQueue.getJob(fileId);
            const fileJobState = fileJob ? await fileJob.getState() : null;

            // Also check file status directly (job may have completed and cleaned up)
            const fileStatus = await getFileStatus(fileId);

            if (
              fileJobState === "completed" ||
              fileStatus?.status === "ready" ||
              !fileJob // Job doesn't exist (already completed/cleaned)
            ) {
              logger.info(
                {
                  jobId: job.id,
                  fileId,
                  fileJobState,
                  fileStatus: fileStatus?.status,
                },
                "chat_job_file_ready",
              );
              break;
            }

            if (fileJobState === "failed" || fileStatus?.status === "error") {
              logger.warn(
                {
                  jobId: job.id,
                  fileId,
                  fileJobState,
                  fileStatus: fileStatus?.status,
                },
                "chat_job_file_failed_continuing",
              );
              break;
            }

            // Wait and poll again
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        }

        // Refresh conversation state to get updated uploadedDatasets
        const freshConversationState =
          await getConversationState(conversationStateId);
        if (freshConversationState) {
          conversationState.values = freshConversationState.values;
          logger.info(
            {
              jobId: job.id,
              uploadedDatasetsCount:
                freshConversationState.values.uploadedDatasets?.length || 0,
            },
            "chat_job_refreshed_conversation_state_for_planning",
          );
        }
      }
    }

    // Update progress: Planning
    await job.updateProgress({ stage: "planning", percent: 10 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "planning", 10);

    // Step 1: Execute planning agent
    logger.info({ jobId: job.id }, "chat_job_planning");

    const { planningAgent } = await import("../../../agents/planning");

    const planningResult = await planningAgent({
      state,
      conversationState,
      message: messageRecord,
      mode: "initial",
      usageType: "chat",
    });

    const plan = planningResult.plan;

    // Filter to only LITERATURE tasks (no ANALYSIS for regular chat)
    const literatureTasks = plan.filter((task) => task.type === "LITERATURE");

    logger.info(
      {
        jobId: job.id,
        totalTasks: plan.length,
        literatureTasks: literatureTasks.length,
      },
      "chat_job_planning_completed",
    );

    // Update progress: Literature
    await job.updateProgress({
      stage: "literature",
      percent: 30,
    } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "literature", 30);

    // Step 2: Execute literature tasks
    const { literatureAgent } = await import("../../../agents/literature");
    const completedTasks: PlanTask[] = [];

    for (const task of literatureTasks) {
      task.start = new Date().toISOString();
      task.output = "";

      const useBioLiterature =
        process.env.PRIMARY_LITERATURE_AGENT?.toUpperCase() === "BIO";

      // Build list of literature promises based on configured sources
      const literaturePromises: Promise<void>[] = [];

      // OpenScholar (enabled if OPENSCHOLAR_API_URL is configured)
      if (process.env.OPENSCHOLAR_API_URL) {
        const openScholarPromise = literatureAgent({
          objective: task.objective,
          type: "OPENSCHOLAR",
        }).then((result) => {
          task.output += `${result.output}\n\n`;
        });
        literaturePromises.push(openScholarPromise);
      }

      // BioLit (enabled if PRIMARY_LITERATURE_AGENT=BIO)
      if (useBioLiterature) {
        const bioLiteraturePromise = literatureAgent({
          objective: task.objective,
          type: "BIOLIT",
        }).then((result) => {
          task.output += `${result.output}\n\n`;
        });
        literaturePromises.push(bioLiteraturePromise);
      }

      // Knowledge base (enabled if KNOWLEDGE_DOCS_PATH is configured)
      if (process.env.KNOWLEDGE_DOCS_PATH) {
        const knowledgePromise = literatureAgent({
          objective: task.objective,
          type: "KNOWLEDGE",
        }).then((result) => {
          task.output += `${result.output}\n\n`;
        });
        literaturePromises.push(knowledgePromise);
      }

      await Promise.all(literaturePromises);

      task.end = new Date().toISOString();
      completedTasks.push(task);
    }

    logger.info(
      { jobId: job.id, completedTasksCount: completedTasks.length },
      "chat_job_literature_completed",
    );

    // Update progress: Hypothesis
    await job.updateProgress({
      stage: "hypothesis",
      percent: 60,
    } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "hypothesis", 60);

    // Step 3: Check if hypothesis is needed
    const allLiteratureOutput = completedTasks
      .map((t) => t.output)
      .join("\n\n");
    const needsHypothesis = await checkRequiresHypothesis(
      message,
      allLiteratureOutput,
      messageId,
    );

    let hypothesisText: string | undefined;

    // Step 4: Generate hypothesis if needed
    if (needsHypothesis && completedTasks.length > 0) {
      logger.info({ jobId: job.id }, "chat_job_generating_hypothesis");

      const { hypothesisAgent } = await import("../../../agents/hypothesis");

      const hypothesisResult = await hypothesisAgent({
        objective: planningResult.currentObjective,
        message: messageRecord,
        conversationState,
        completedTasks,
      });

      hypothesisText = hypothesisResult.hypothesis;
      conversationState.values.currentHypothesis = hypothesisText;

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
      }

      // Step 5: Run reflection agent
      logger.info({ jobId: job.id }, "chat_job_reflection");

      const { reflectionAgent } = await import("../../../agents/reflection");

      const reflectionResult = await reflectionAgent({
        conversationState,
        message: messageRecord,
        completedMaxTasks: completedTasks,
        hypothesis: hypothesisText,
      });

      // Update conversation state with reflection results
      conversationState.values.currentObjective =
        reflectionResult.currentObjective;
      conversationState.values.keyInsights = reflectionResult.keyInsights;
      conversationState.values.methodology = reflectionResult.methodology;

      if (conversationState.id) {
        await updateConversationState(
          conversationState.id,
          conversationState.values,
        );
      }
    }

    // Update progress: Reply
    await job.updateProgress({ stage: "reply", percent: 90 } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 90);

    // Step 6: Generate reply
    logger.info({ jobId: job.id }, "chat_job_generating_reply");

    const { generateChatReply } = await import("../../../agents/reply/utils");

    // Log uploaded datasets info for debugging
    const uploadedDatasets = conversationState.values.uploadedDatasets || [];
    logger.info(
      {
        jobId: job.id,
        uploadedDatasetsCount: uploadedDatasets.length,
        datasetsInfo: uploadedDatasets.map((d: any) => ({
          filename: d.filename,
          hasContent: !!d.content,
          contentLength: d.content?.length || 0,
          contentPreview: d.content?.slice(0, 100) || "no content",
        })),
      },
      "chat_job_uploaded_datasets",
    );

    const replyText = await generateChatReply(
      message,
      {
        completedTasks,
        hypothesis: hypothesisText,
        nextPlan: [],
        keyInsights: conversationState.values.keyInsights || [],
        discoveries: conversationState.values.discoveries || [],
        methodology: conversationState.values.methodology,
        currentObjective: conversationState.values.currentObjective,
        uploadedDatasets,
      },
      {
        maxTokens: 1024,
        messageId,
        usageType: "chat",
      },
    );

    // Save reply to message
    await updateMessage(messageId, { content: replyText });

    // Calculate and update response time
    const responseTime = Date.now() - startTime;
    await updateMessageResponseTime(messageId, responseTime);

    // Notify: Message updated (content is now available)
    await notifyMessageUpdated(job.id!, conversationId, messageId);

    logger.info(
      {
        jobId: job.id,
        messageId,
        responseTime,
        responseTimeSec: (responseTime / 1000).toFixed(2),
      },
      "chat_job_completed",
    );

    // Notify: Job completed
    await notifyJobCompleted(job.id!, conversationId, messageId);

    return {
      text: replyText,
      userId,
      responseTime,
    };
  } catch (error) {
    logger.error(
      {
        jobId: job.id,
        error,
        attempt: job.attemptsMade + 1,
        willRetry: job.attemptsMade + 1 < (job.opts.attempts || 3),
      },
      "chat_job_failed",
    );

    // Notify: Job failed (only on final attempt)
    if (job.attemptsMade + 1 >= (job.opts.attempts || 3)) {
      await notifyJobFailed(job.id!, conversationId, messageId);
    }

    // Re-throw to trigger retry (if attempts remaining)
    throw error;
  }
}

/**
 * Check if the question requires a hypothesis using LLM
 * Extracted from routes/chat.ts requiresHypothesis function
 */
async function checkRequiresHypothesis(
  question: string,
  literatureResults: string,
  messageId?: string, // For token usage tracking
): Promise<boolean> {
  const { LLM } = await import("../../../llm/provider");

  const PLANNING_LLM_PROVIDER = process.env.PLANNING_LLM_PROVIDER || "google";
  const apiKey = process.env[`${PLANNING_LLM_PROVIDER.toUpperCase()}_API_KEY`];

  if (!apiKey) {
    logger.warn("LLM API key not configured, defaulting to no hypothesis");
    return false;
  }

  const llmProvider = new LLM({
    // @ts-ignore
    name: PLANNING_LLM_PROVIDER,
    apiKey,
  });

  const prompt = `Analyze this user question and literature results to determine if a research hypothesis is needed.

User Question: ${question}

Literature Results Preview: ${literatureResults.slice(0, 1000)}

A hypothesis IS needed if:
- The question asks about mechanisms, predictions, or causal relationships
- The question requires synthesizing multiple sources into a novel insight
- The question is exploratory and needs a testable proposition

A hypothesis IS NOT needed if:
- The question asks for factual information or definitions
- The question can be answered directly from literature
- The question is a simple lookup or clarification

Respond with ONLY "YES" if a hypothesis is needed, or "NO" if it's not needed.`;

  try {
    const response = await llmProvider.createChatCompletion({
      model: process.env.PLANNING_LLM_MODEL || "gemini-2.5-flash",
      messages: [{ role: "user" as const, content: prompt }],
      maxTokens: 10,
      messageId,
      usageType: "chat",
    });

    const answer = response.content.trim().toUpperCase();
    return answer === "YES";
  } catch (err) {
    logger.error({ err }, "hypothesis_check_failed");
    return false;
  }
}

/**
 * Start the chat worker
 */
export function startChatWorker(): Worker {
  const concurrency = parseInt(process.env.CHAT_QUEUE_CONCURRENCY || "5");

  const worker = new Worker<ChatJobData, ChatJobResult>(
    "chat",
    processChatJob,
    {
      connection: getBullMQConnection(),
      concurrency,
      // Chat jobs typically complete in 1-3 minutes
      // lockRenewTime must be significantly less than lockDuration (1/5 ratio)
      lockDuration: 300000, // 5 minutes
      lockRenewTime: 60000, // 1 minute - renew well before lock expires
      stalledInterval: 120000, // 2 minutes
    },
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, responseTime: result.responseTime },
      "chat_worker_job_completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      },
      "chat_worker_job_failed_permanently",
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "chat_worker_job_stalled");
  });

  logger.info({ concurrency }, "chat_worker_started");

  return worker;
}
