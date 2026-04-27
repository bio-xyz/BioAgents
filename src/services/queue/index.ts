/**
 * BullMQ Queue Module
 *
 * Exports all queue-related functionality.
 * Use isJobQueueEnabled() to check if queues should be used.
 */

// Connection management
export {
  closeConnections,
  getBullMQConnection,
  getPublisher,
  getSubscriber,
  isJobQueueEnabled,
} from "./connection";
// Notification helpers
export {
  notify,
  notifyJobCompleted,
  notifyJobFailed,
  notifyJobProgress,
  notifyJobStarted,
  notifyMessageUpdated,
  notifyStateUpdated,
} from "./notify";
// Queue instances
export { closeQueues, getChatQueue, getDeepResearchQueue } from "./queues";
// Types
export type {
  ChatJobData,
  ChatJobResult,
  DeepResearchJobData,
  DeepResearchJobResult,
  JobProgress,
  Notification,
  NotificationType,
} from "./types";

// Workers (for worker process)
export { startChatWorker } from "./workers/chat.worker";
export { startDeepResearchWorker } from "./workers/deep-research.worker";
