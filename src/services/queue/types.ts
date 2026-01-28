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
 *
 * Architecture: Iteration-per-job
 * Each job executes exactly ONE iteration. If the research should continue,
 * the worker enqueues the next iteration as a new job. This provides:
 * - Atomic iterations (either fully complete or never started)
 * - Better graceful shutdown (each job ~5-10 min instead of 20+ min)
 * - Natural retry on failure (no partial state to rollback)
 */
export interface DeepResearchJobData {
  // Same core fields as ChatJobData
  userId: string;
  conversationId: string;
  messageId: string; // The message THIS iteration writes to
  message: string;
  authMethod: AuthMethod;
  fileIds?: string[];
  requestedAt: string;

  // Deep research specific
  stateId: string;
  conversationStateId: string;

  // Research mode - determines iteration behavior
  // 'semi-autonomous' (default): Uses MAX_AUTO_ITERATIONS env var (default 5)
  // 'fully-autonomous': Continues until research is done or hard cap of 20 iterations
  // 'steering': Single iteration only, always asks user for feedback
  researchMode?: "semi-autonomous" | "fully-autonomous" | "steering";

  // Iteration tracking (for job chaining)
  iterationNumber: number; // 1, 2, 3... (starts at 1)
  rootJobId?: string; // Original job ID for tracking the chain
  isInitialIteration: boolean; // true for first iteration (runs planning), false for continuations (uses promoted tasks)
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
 * Job data for paper generation queue
 * Sent to /api/deep-research/conversations/:id/paper/async, processed by paper-generation worker
 */
export interface PaperGenerationJobData {
  paperId: string;
  userId: string;
  conversationId: string;
  authMethod: AuthMethod;
  requestedAt: string;
}

/**
 * Result returned by paper generation worker on completion
 */
export interface PaperGenerationJobResult {
  paperId: string;
  conversationId: string;
  pdfPath: string;
  pdfUrl?: string;
  rawLatexUrl?: string;
  status: "completed" | "failed";
  error?: string;
  responseTime: number;
}

/**
 * Paper generation progress stages
 */
export type PaperGenerationStage =
  | "validating"
  | "metadata"
  | "figures"
  | "discoveries"
  | "bibliography"
  | "latex_assembly"
  | "compilation"
  | "upload"
  | "cleanup";

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
  | "file:error"
  | "paper:started"
  | "paper:progress"
  | "paper:completed"
  | "paper:failed";

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
  paperId?: string;
  progress?: { stage: string; percent: number };
  description?: string;
  error?: string;
}
