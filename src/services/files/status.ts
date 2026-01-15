/**
 * File Status Tracking Service
 * Tracks temporary file upload/processing status
 *
 * - In-process mode: Uses in-memory Map
 * - Queue mode: Uses Redis for cross-process status
 */

import logger from "../../utils/logger";
import { isJobQueueEnabled } from "../queue/connection";

export type FileStatus =
  | "pending" // Upload URL generated, waiting for upload
  | "uploaded" // File in S3, not yet processed
  | "processing" // Processing job running
  | "ready" // Processed and ready to use
  | "error"; // Processing failed

export interface FileStatusRecord {
  fileId: string;
  userId: string;
  conversationId: string;
  conversationStateId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  size: number;
  status: FileStatus;
  description?: string;
  error?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

// In-memory store for non-queue mode
const fileStatusMap = new Map<string, FileStatusRecord>();

// TTL for status records (configurable, default 1 hour)
const statusTtlMinutes = parseInt(
  process.env.FILE_STATUS_TTL_MINUTES || "60",
  10,
);
const STATUS_TTL_MS = statusTtlMinutes * 60 * 1000;

/**
 * Get Redis client for queue mode
 */
async function getRedisClient() {
  if (!isJobQueueEnabled()) {
    return null;
  }
  const { getBullMQConnection } = await import("../queue/connection");
  return getBullMQConnection();
}

/**
 * Create a new file status record
 */
export async function createFileStatus(
  data: Omit<
    FileStatusRecord,
    "status" | "createdAt" | "updatedAt" | "expiresAt"
  >,
): Promise<FileStatusRecord> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + STATUS_TTL_MS).toISOString();

  const record: FileStatusRecord = {
    ...data,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  const redis = await getRedisClient();

  if (redis) {
    // Queue mode: Store in Redis
    const key = `file:status:${data.fileId}`;
    await redis.set(
      key,
      JSON.stringify(record),
      "EX",
      Math.floor(STATUS_TTL_MS / 1000),
    );
    logger.info({ fileId: data.fileId, key }, "file_status_created_redis");
  } else {
    // In-process mode: Store in memory
    fileStatusMap.set(data.fileId, record);
    logger.info({ fileId: data.fileId }, "file_status_created_memory");
  }

  return record;
}

/**
 * Get file status by fileId
 */
export async function getFileStatus(
  fileId: string,
): Promise<FileStatusRecord | null> {
  const redis = await getRedisClient();

  if (redis) {
    const key = `file:status:${fileId}`;
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data) as FileStatusRecord;
    }
    return null;
  } else {
    return fileStatusMap.get(fileId) || null;
  }
}

/**
 * Update file status
 */
export async function updateFileStatus(
  fileId: string,
  updates: Partial<
    Pick<FileStatusRecord, "status" | "description" | "error" | "jobId">
  >,
): Promise<FileStatusRecord | null> {
  const record = await getFileStatus(fileId);

  if (!record) {
    logger.warn({ fileId }, "file_status_not_found_for_update");
    return null;
  }

  const updatedRecord: FileStatusRecord = {
    ...record,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const redis = await getRedisClient();

  if (redis) {
    const key = `file:status:${fileId}`;
    // Recalculate TTL based on remaining time
    const remainingTtl = Math.max(
      0,
      Math.floor((new Date(record.expiresAt).getTime() - Date.now()) / 1000),
    );
    await redis.set(
      key,
      JSON.stringify(updatedRecord),
      "EX",
      remainingTtl || 3600,
    );
    logger.info(
      { fileId, status: updates.status },
      "file_status_updated_redis",
    );
  } else {
    fileStatusMap.set(fileId, updatedRecord);
    logger.info(
      { fileId, status: updates.status },
      "file_status_updated_memory",
    );
  }

  return updatedRecord;
}

/**
 * Delete file status
 */
export async function deleteFileStatus(fileId: string): Promise<void> {
  const redis = await getRedisClient();

  if (redis) {
    const key = `file:status:${fileId}`;
    await redis.del(key);
    logger.info({ fileId }, "file_status_deleted_redis");
  } else {
    fileStatusMap.delete(fileId);
    logger.info({ fileId }, "file_status_deleted_memory");
  }
}

/**
 * Get all pending/processing file IDs for a conversation state
 * Used by chat worker to wait for file processing to complete
 */
export async function getPendingFileIds(
  conversationStateId: string,
): Promise<string[]> {
  const redis = await getRedisClient();

  if (redis) {
    // In queue mode, scan Redis for file status keys
    const pendingFileIds: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        "file:status:*",
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const record = JSON.parse(data) as FileStatusRecord;
          if (
            record.conversationStateId === conversationStateId &&
            (record.status === "pending" ||
              record.status === "uploaded" ||
              record.status === "processing")
          ) {
            pendingFileIds.push(record.fileId);
          }
        }
      }
    } while (cursor !== "0");

    return pendingFileIds;
  } else {
    // In-memory mode
    const pendingFileIds: string[] = [];
    for (const [fileId, record] of fileStatusMap) {
      if (
        record.conversationStateId === conversationStateId &&
        (record.status === "pending" ||
          record.status === "uploaded" ||
          record.status === "processing")
      ) {
        pendingFileIds.push(fileId);
      }
    }
    return pendingFileIds;
  }
}

/**
 * Clean up expired in-memory status records
 * Call this periodically in non-queue mode
 */
export function cleanupExpiredStatus(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [fileId, record] of fileStatusMap) {
    if (new Date(record.expiresAt).getTime() < now) {
      fileStatusMap.delete(fileId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, "expired_file_status_cleaned");
  }
}
