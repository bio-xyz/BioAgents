/**
 * Chat worker for BullMQ.
 *
 * Thin adapter around runChatAgent: load message + conversation state, wait
 * for any pending file uploads, dispatch to the shared chat-agent runner,
 * persist the reply, emit progress/completion notifications.
 *
 * The route handler (routes/chat.ts) drives the in-process and SSE paths
 * through the same runChatAgent — this worker is only the queue transport.
 */

import { Job, Worker } from "bullmq";
import type { ConversationState, DataArtifact, State } from "../../../types/core";
import type { SourceSelectionId } from "../../../types/sourceSelection";
import logger from "../../../utils/logger";
import { buildMessageStateValues } from "../../../utils/messageState";
import { persistNormalChatArtifacts } from "../../chat/artifactPersistence";
import { runSegmentAnythingChatTool } from "../../segment-anything/chat-tool";
import { runTargetChatTool, TargetChatToolError } from "../../target/chat-tool";
import { getBullMQConnection } from "../connection";
import {
  notifyJobCompleted,
  notifyJobFailed,
  notifyJobProgress,
  notifyJobStarted,
  notifyMessageUpdated,
  notifyStateUpdated,
} from "../notify";
import type { ChatJobData, ChatJobResult, JobProgress } from "../types";

/**
 * Throws UnrecoverableError when markMessageComplete reported the row was
 * no longer PENDING. Keeping the BullMQ job in `failed` state preserves
 * retryability through `/api/chat/retry/:jobId`; returning success would
 * mark the job `completed` and dead-end the user.
 */
async function failJobIfRowNoLongerPending(
  updated: boolean,
  jobId: string | undefined,
  messageId: string,
  logKey: string
): Promise<void> {
  if (updated) return;
  const { UnrecoverableError } = await import("bullmq");
  logger.warn({ jobId, messageId }, logKey);
  throw new UnrecoverableError("Message row is no longer in PENDING state; cannot persist reply");
}

async function processChatJob(job: Job<ChatJobData, ChatJobResult>): Promise<ChatJobResult> {
  const startTime = Date.now();
  const { conversationId, messageId, message } = job.data;

  if (job.attemptsMade > 0) {
    logger.warn(
      {
        attempt: job.attemptsMade + 1,
        jobId: job.id,
        maxAttempts: job.opts.attempts,
        messageId,
      },
      "chat_job_retry_attempt"
    );
  }

  logger.info({ conversationId, jobId: job.id, messageId }, "chat_job_started");
  await notifyJobStarted(job.id!, conversationId, messageId);

  try {
    const { getMessage, getState, getConversationState, getConversation } = await import(
      "../../../db/operations"
    );

    const messageRecord = await getMessage(messageId);
    if (!messageRecord) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const stateRecord = await getState(messageRecord.state_id);
    if (!stateRecord) {
      throw new Error(`State not found for message: ${messageId}`);
    }

    const conversation = await getConversation(conversationId);
    const conversationStateRecord = await getConversationState(conversation.conversation_state_id);

    const state: State = {
      id: stateRecord.id,
      values: buildMessageStateValues({
        baseValues: stateRecord.values,
        message: messageRecord,
      }),
    };
    state.values.sourceSelectionId = job.data.sourceSelectionId ?? state.values.sourceSelectionId;

    const conversationState: ConversationState = {
      id: conversationStateRecord.id,
      values: conversationStateRecord.values,
    };

    // Wait for any pending file processing jobs BEFORE running the agent
    // so uploaded datasets are available in conversation state.
    const { getPendingFileIds, getFileStatus } = await import("../../files/status");
    const { getFileProcessQueue } = await import("../queues");

    const conversationStateId = conversationState.id;
    if (conversationStateId) {
      const pendingFileIds = await getPendingFileIds(conversationStateId);

      if (pendingFileIds.length > 0) {
        logger.info(
          { conversationStateId, jobId: job.id, pendingFileIds },
          "chat_job_waiting_for_file_processing"
        );

        const { waitForPendingFiles } = await import("../../files/waitForPending");
        await waitForPendingFiles({
          conversationStateId,
          fileProcessQueue: getFileProcessQueue(),
          getFileStatus,
          jobId: job.id,
          pendingFileIds,
        });

        const freshConversationState = await getConversationState(conversationStateId);
        if (freshConversationState) {
          conversationState.values = freshConversationState.values;
          logger.info(
            {
              jobId: job.id,
              uploadedDatasetsCount: freshConversationState.values.uploadedDatasets?.length || 0,
            },
            "chat_job_refreshed_conversation_state_for_planning"
          );
        }
      }
    }

    if (job.data.toolId === "segment-anything") {
      return await runSegmentAnythingForJob(
        job,
        conversationId,
        messageId,
        message,
        conversationState,
        startTime
      );
    }

    if (job.data.toolId === "target") {
      return await runTargetForJob(
        job,
        conversationId,
        messageId,
        message,
        conversationState,
        startTime
      );
    }

    return await runChatAgentForJob(
      job,
      conversationId,
      messageId,
      message,
      conversationState,
      startTime,
      job.data.sourceSelectionId ?? state.values.sourceSelectionId
    );
  } catch (error) {
    logger.error(
      {
        attempt: job.attemptsMade + 1,
        error,
        jobId: job.id,
        willRetry: job.attemptsMade + 1 < (job.opts.attempts || 3),
      },
      "chat_job_failed"
    );

    const { UnrecoverableError } = await import("bullmq");
    if (job.attemptsMade + 1 >= (job.opts.attempts || 3) || error instanceof UnrecoverableError) {
      const { markMessageFailed } = await import("../../chat/tools");
      await Promise.all([
        notifyJobFailed(job.id!, conversationId, messageId),
        markMessageFailed(messageId),
      ]);
    }

    throw error;
  }
}

async function runSegmentAnythingForJob(
  job: Job<ChatJobData, ChatJobResult>,
  conversationId: string,
  messageId: string,
  message: string,
  conversationState: ConversationState,
  startTime: number
): Promise<ChatJobResult> {
  const { userId } = job.data;

  const segmentResult = await runSegmentAnythingChatTool({
    conversationState,
    message,
    messageId,
    toolInput: job.data.toolInput,
    userId,
  });

  const responseTime = Date.now() - startTime;
  await persistNormalChatArtifacts({
    artifacts: segmentResult.artifacts,
    conversationState,
    messageId,
  });

  const { markMessageComplete } = await import("../../chat/tools");
  const { updated } = await markMessageComplete(messageId, {
    content: segmentResult.text,
    response_time: responseTime,
  });
  await failJobIfRowNoLongerPending(
    updated,
    job.id,
    messageId,
    "chat_worker_segment_anything_complete_skipped_row_not_pending"
  );

  try {
    await notifyJobCompleted(job.id!, conversationId, messageId, undefined, {
      artifacts: segmentResult.artifacts,
    });
  } catch (notifyErr) {
    logger.warn(
      { error: notifyErr, jobId: job.id, messageId },
      "chat_worker_segment_anything_job_completed_notify_failed"
    );
  }

  try {
    await notifyMessageUpdated(job.id!, conversationId, messageId);
  } catch (notifyErr) {
    logger.warn(
      { error: notifyErr, jobId: job.id, messageId },
      "chat_worker_segment_anything_message_updated_notify_failed"
    );
  }

  return {
    artifacts: segmentResult.artifacts,
    responseTime,
    text: segmentResult.text,
    userId,
  };
}

async function runTargetForJob(
  job: Job<ChatJobData, ChatJobResult>,
  conversationId: string,
  messageId: string,
  message: string,
  conversationState: ConversationState,
  startTime: number
): Promise<ChatJobResult> {
  const { userId } = job.data;

  let targetResult: Awaited<ReturnType<typeof runTargetChatTool>>;
  try {
    targetResult = await runTargetChatTool({
      message,
      messageId,
      toolInput: job.data.toolInput,
    });
  } catch (err) {
    const statusCode = err instanceof TargetChatToolError ? err.statusCode : 502;
    logger.warn({ err, jobId: job.id, messageId, statusCode }, "chat_worker_target_tool_error");
    throw err;
  }

  const responseTime = Date.now() - startTime;
  await persistNormalChatArtifacts({
    artifacts: targetResult.artifacts,
    conversationState,
    messageId,
  });

  const { markMessageComplete } = await import("../../chat/tools");
  const { updated } = await markMessageComplete(messageId, {
    content: targetResult.text,
    response_time: responseTime,
  });
  await failJobIfRowNoLongerPending(
    updated,
    job.id,
    messageId,
    "chat_worker_target_complete_skipped_row_not_pending"
  );

  try {
    await notifyJobCompleted(job.id!, conversationId, messageId, undefined, {
      artifacts: targetResult.artifacts,
    });
  } catch (notifyErr) {
    logger.warn(
      { error: notifyErr, jobId: job.id, messageId },
      "chat_worker_target_job_completed_notify_failed"
    );
  }

  try {
    await notifyMessageUpdated(job.id!, conversationId, messageId);
  } catch (notifyErr) {
    logger.warn(
      { error: notifyErr, jobId: job.id, messageId },
      "chat_worker_target_message_updated_notify_failed"
    );
  }

  return {
    artifacts: targetResult.artifacts,
    responseTime,
    text: targetResult.text,
    userId,
  };
}

/**
 * Run the shared chat-agent runner inside the queue worker context: wire
 * tool-result callbacks to DB state + frontend progress notifications,
 * persist the reply, then emit completion notifications.
 */
async function runChatAgentForJob(
  job: Job<ChatJobData, ChatJobResult>,
  conversationId: string,
  messageId: string,
  message: string,
  conversationState: ConversationState,
  startTime: number,
  sourceSelectionId?: SourceSelectionId
): Promise<ChatJobResult> {
  const { userId } = job.data;

  // Emit "planning" stage for frontend compatibility
  await job.updateProgress({ percent: 10, stage: "planning" } as JobProgress);
  await notifyJobProgress(job.id!, conversationId, "planning", 10);

  // Misconfigured API key won't self-heal between retries — fail fast
  if (!process.env.ANTHROPIC_API_KEY) {
    const { UnrecoverableError } = await import("bullmq");
    throw new UnrecoverableError("Anthropic API key is not configured");
  }

  const { runChatAgent } = await import("../../../chat-agent/runner");

  let literatureEmitted = false;

  const result = await runChatAgent({
    conversationId,
    loadHistory: true,
    message,
    onToolResult: async (info) => {
      if (conversationState.id) {
        try {
          const { updateConversationState } = await import("../../../db/operations");
          await updateConversationState(conversationState.id, {
            ...conversationState.values,
            agentProgress: {
              isError: info.result.isError ?? false,
              lastToolCallId: info.toolCallId,
              stage: `tool:${info.toolName}`,
              toolCallCount: info.toolCallCount,
            },
          });
          await notifyStateUpdated(job.id!, conversationId, conversationState.id);
        } catch (err) {
          logger.warn({ error: err }, "worker_conversation_state_update_failed");
        }
      }

      if (info.toolName === "literature_search" && !literatureEmitted) {
        literatureEmitted = true;
        await job.updateProgress({ percent: 40, stage: "literature" } as JobProgress);
        await notifyJobProgress(job.id!, conversationId, "literature", 40);
      }
    },
    sourceSelectionId,
    uploadedDatasets: conversationState.values.uploadedDatasets,
  });

  const { finalizeChatReply } = await import("../../chat/finalizeReply");
  const outcome = await finalizeChatReply({
    agentResult: result,
    conversationState,
    messageId,
    startTime,
  });

  // Truncated/empty use UnrecoverableError so BullMQ skips retries — the
  // same prompt would just hit the same token limit again.
  if (outcome.kind === "truncated" || outcome.kind === "empty") {
    const { UnrecoverableError } = await import("bullmq");
    throw new UnrecoverableError("Agent loop response truncated (max_tokens)");
  }

  if (outcome.kind === "save_skipped") {
    await failJobIfRowNoLongerPending(
      false,
      job.id,
      messageId,
      "chat_worker_agent_loop_complete_skipped_row_not_pending"
    );
    // failJobIfRowNoLongerPending always throws when updated=false.
    throw new Error("unreachable");
  }

  const responseTime = outcome.responseTime;

  // Best-effort: progress updates and notifications. Reply is already saved,
  // so failures here should not trigger a retry or mark the job as failed.
  try {
    await job.updateProgress({ percent: 90, stage: "reply" } as JobProgress);
    await notifyJobProgress(job.id!, conversationId, "reply", 90);
    await notifyMessageUpdated(job.id!, conversationId, messageId);
    await notifyJobCompleted(job.id!, conversationId, messageId, undefined, {
      proteinStructures: result.proteinStructures,
    });
  } catch (notifyErr) {
    logger.warn(
      { error: notifyErr, jobId: job.id, messageId },
      "chat_job_post_reply_notify_failed"
    );
  }

  logger.info(
    {
      jobId: job.id,
      messageId,
      responseTime,
      responseTimeSec: (responseTime / 1000).toFixed(2),
      toolCallCount: result.toolCallCount,
    },
    "chat_job_agent_loop_completed"
  );

  return {
    proteinStructures: result.proteinStructures,
    responseTime,
    text: result.replyText,
    userId,
  };
}

export function startChatWorker(): Worker {
  const concurrency = parseInt(process.env.CHAT_QUEUE_CONCURRENCY || "5");

  const worker = new Worker<ChatJobData, ChatJobResult>("chat", processChatJob, {
    concurrency,
    connection: getBullMQConnection(),
    // Chat jobs typically complete in 1-3 minutes
    // lockRenewTime must be significantly less than lockDuration (1/5 ratio)
    lockDuration: 300000, // 5 minutes
    lockRenewTime: 60000,
    stalledInterval: 120000,
  });

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, responseTime: result.responseTime }, "chat_worker_job_completed");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        attemptsMade: job?.attemptsMade,
        error: error.message,
        jobId: job?.id,
      },
      "chat_worker_job_failed_permanently"
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "chat_worker_job_stalled");
  });

  logger.info({ concurrency }, "chat_worker_started");

  return worker;
}
