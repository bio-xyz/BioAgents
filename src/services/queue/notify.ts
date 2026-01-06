/**
 * Notification Helper for BullMQ Workers
 *
 * Publishes notifications via Redis Pub/Sub to notify the API server
 * (and connected WebSocket clients) about job progress.
 *
 * Follows "Notify + Fetch" pattern:
 * - Notifications are lightweight (just type + IDs)
 * - UI fetches actual data via HTTP after notification
 */

import { getPublisher } from "./connection";
import type { Notification, NotificationType } from "./types";
import logger from "../../utils/logger";

/**
 * Publish a notification to Redis Pub/Sub
 *
 * @param notification - The notification to publish
 *
 * Note: This function catches errors internally to avoid crashing workers
 * if Redis is temporarily unavailable. Notifications are best-effort.
 */
export async function notify(notification: Notification): Promise<void> {
  try {
    const publisher = getPublisher();
    const channel = `conversation:${notification.conversationId}`;

    await publisher.publish(channel, JSON.stringify(notification));

    logger.info(
      {
        type: notification.type,
        jobId: notification.jobId,
        conversationId: notification.conversationId,
        channel,
      },
      "notification_published",
    );
  } catch (error) {
    // Log but don't throw - notification failure shouldn't fail the job
    logger.error(
      {
        err: error,
        notification,
      },
      "notification_publish_failed",
    );
  }
}

/**
 * Helper to create and send a job:started notification
 */
export async function notifyJobStarted(
  jobId: string,
  conversationId: string,
  messageId?: string,
  stateId?: string,
): Promise<void> {
  await notify({
    type: "job:started",
    jobId,
    conversationId,
    messageId,
    stateId,
  });
}

/**
 * Helper to create and send a job:progress notification
 */
export async function notifyJobProgress(
  jobId: string,
  conversationId: string,
  stage: string,
  percent: number,
): Promise<void> {
  await notify({
    type: "job:progress",
    jobId,
    conversationId,
    progress: { stage, percent },
  });
}

/**
 * Helper to create and send a job:completed notification
 */
export async function notifyJobCompleted(
  jobId: string,
  conversationId: string,
  messageId?: string,
  stateId?: string,
): Promise<void> {
  await notify({
    type: "job:completed",
    jobId,
    conversationId,
    messageId,
    stateId,
  });
}

/**
 * Helper to create and send a job:failed notification
 */
export async function notifyJobFailed(
  jobId: string,
  conversationId: string,
  messageId?: string,
  stateId?: string,
): Promise<void> {
  await notify({
    type: "job:failed",
    jobId,
    conversationId,
    messageId,
    stateId,
  });
}

/**
 * Helper to create and send a message:updated notification
 * Use this after updating message content in the database
 */
export async function notifyMessageUpdated(
  jobId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await notify({
    type: "message:updated",
    jobId,
    conversationId,
    messageId,
  });
}

/**
 * Helper to create and send a state:updated notification
 * Use this after updating conversation state in the database
 */
export async function notifyStateUpdated(
  jobId: string,
  conversationId: string,
  stateId: string,
): Promise<void> {
  await notify({
    type: "state:updated",
    jobId,
    conversationId,
    stateId,
  });
}

/**
 * Helper to create and send a file:ready notification
 * Use this after a file has been processed successfully
 */
export async function notifyFileReady(
  jobId: string,
  conversationId: string,
  fileId: string,
  description: string,
): Promise<void> {
  await notify({
    type: "file:ready",
    jobId,
    conversationId,
    fileId,
    description,
  });
}

/**
 * Helper to create and send a file:error notification
 * Use this when file processing fails
 */
export async function notifyFileError(
  jobId: string,
  conversationId: string,
  fileId: string,
  error: string,
): Promise<void> {
  await notify({
    type: "file:error",
    jobId,
    conversationId,
    fileId,
    error,
  });
}

/**
 * Helper to create and send a paper:started notification
 */
export async function notifyPaperStarted(
  jobId: string,
  conversationId: string,
  paperId: string,
): Promise<void> {
  await notify({
    type: "paper:started",
    jobId,
    conversationId,
    paperId,
  });
}

/**
 * Helper to create and send a paper:progress notification
 */
export async function notifyPaperProgress(
  jobId: string,
  conversationId: string,
  paperId: string,
  stage: string,
  percent: number,
): Promise<void> {
  await notify({
    type: "paper:progress",
    jobId,
    conversationId,
    paperId,
    progress: { stage, percent },
  });
}

/**
 * Helper to create and send a paper:completed notification
 */
export async function notifyPaperCompleted(
  jobId: string,
  conversationId: string,
  paperId: string,
): Promise<void> {
  await notify({
    type: "paper:completed",
    jobId,
    conversationId,
    paperId,
  });
}

/**
 * Helper to create and send a paper:failed notification
 */
export async function notifyPaperFailed(
  jobId: string,
  conversationId: string,
  paperId: string,
  error: string,
): Promise<void> {
  await notify({
    type: "paper:failed",
    jobId,
    conversationId,
    paperId,
    error,
  });
}

// Alias for backwards compatibility
export { notify as publishNotification };
