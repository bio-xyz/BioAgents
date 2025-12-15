/**
 * BullMQ Queue Module
 *
 * Exports all queue-related functionality.
 * Use isJobQueueEnabled() to check if queues should be used.
 */

// Connection management
export {
  getBullMQConnection,
  getPublisher,
  getSubscriber,
  isJobQueueEnabled,
  closeConnections,
} from "./connection";

// Queue instances
export { getChatQueue, getDeepResearchQueue, closeQueues } from "./queues";

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

// Notification helpers
export {
  notify,
  notifyJobStarted,
  notifyJobProgress,
  notifyJobCompleted,
  notifyJobFailed,
  notifyMessageUpdated,
  notifyStateUpdated,
} from "./notify";

// Workers (for worker process)
export { startChatWorker } from "./workers/chat.worker";
export { startDeepResearchWorker } from "./workers/deep-research.worker";
