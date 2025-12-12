/**
 * BullMQ Job Types for Chat and Deep Research Queues
 *
 * These types define the data structures for jobs enqueued to BullMQ.
 * Job data must be serializable (no File objects, only IDs/references).
 */

import type { AuthMethod } from "../types/auth";

/**
 * Job data for chat queue
 * Sent to /api/chat, processed by chat worker
 */
export interface ChatJobData {
  // Request context
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;

  // Auth context (preserved for worker processing)
  authMethod: AuthMethod;

  // File references (files uploaded before enqueue, stored in conversationState)
  fileIds?: string[];

  // Metadata
  requestedAt: string;
}

/**
 * Job data for deep research queue
 * Sent to /api/deep-research/start, processed by deep-research worker
 */
export interface DeepResearchJobData {
  // Same core fields as ChatJobData
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;
  authMethod: AuthMethod;
  fileIds?: string[];
  requestedAt: string;

  // Deep research specific
  stateId: string;
  conversationStateId: string;
}

/**
 * Job progress tracking
 * Used with job.updateProgress() for real-time updates
 */
export interface JobProgress {
  stage: string;
  percent: number;
  message?: string;
}

/**
 * Result returned by chat worker on completion
 */
export interface ChatJobResult {
  text: string;
  userId: string;
  responseTime: number;
}

/**
 * Result returned by deep research worker on completion
 */
export interface DeepResearchJobResult {
  messageId: string;
  status: "completed" | "failed";
  responseTime: number;
}

/**
 * Notification types sent via Redis Pub/Sub
 */
export type NotificationType =
  | "job:started"
  | "job:progress"
  | "job:completed"
  | "job:failed"
  | "message:updated"
  | "state:updated";

/**
 * Notification payload structure
 * Sent from workers to API server via Redis Pub/Sub
 */
export interface Notification {
  type: NotificationType;
  jobId: string;
  conversationId: string;
  messageId?: string;
  stateId?: string;
  progress?: { stage: string; percent: number };
}
