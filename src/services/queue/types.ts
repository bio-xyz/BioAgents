/**
 * BullMQ Job Types for Chat and Deep Research Queues
 *
 * These types define the data structures for jobs enqueued to BullMQ.
 * Job data must be serializable (no File objects, only IDs/references).
 */

import type { AuthMethod } from "../../types/auth";

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

  // Autonomous continuation mode
  // false (default): Uses MAX_AUTO_ITERATIONS env var (default 5)
  // true: Continues until research is done or hard cap of 20 iterations
  fullyAutonomous?: boolean;
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
 * Job data for file process queue
 * Processes uploaded files (generates description, updates state)
 */
export interface FileProcessJobData {
  fileId: string;
  userId: string;
  conversationId: string;
  conversationStateId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Result returned by file process worker on completion
 */
export interface FileProcessJobResult {
  fileId: string;
  description: string;
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
  | "state:updated"
  | "file:ready"
  | "file:error";

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
  fileId?: string;
  progress?: { stage: string; percent: number };
  description?: string;
  error?: string;
}
