/**
 * File Service
 * Handles file upload URL generation, confirmation, and processing
 */

import {
  getConversationState,
  updateConversationState,
  createConversation,
  createConversationState,
  createUser,
} from "../../db/operations";
import {
  getFileUploadPath,
  getStorageProvider,
  getMimeTypeFromFilename,
  getUploadPath,
} from "../../storage";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";
import { isJobQueueEnabled } from "../queue/connection";
import { generateFileDescription, parseFilePreview } from "./description";
import {
  createFileStatus,
  getFileStatus,
  updateFileStatus,
  deleteFileStatus,
  type FileStatusRecord,
} from "./status";

// Preview size for description generation (4KB)
const PREVIEW_SIZE = 4 * 1024;

// Default presigned URL expiration (1 hour)
const UPLOAD_URL_EXPIRATION = 3600;

export interface RequestUploadUrlParams {
  filename: string;
  contentType: string;
  size: number;
  conversationId?: string;
  userId: string;
}

export interface RequestUploadUrlResult {
  fileId: string;
  uploadUrl: string;
  s3Key: string;
  expiresAt: string;
  conversationId: string;
  conversationStateId: string;
}

export interface ConfirmUploadParams {
  fileId: string;
  userId: string;
}

export interface ConfirmUploadResult {
  fileId: string;
  status: "ready" | "processing";
  filename: string;
  size: number;
  description?: string;
  jobId?: string;
}

// Maximum file size: 2GB
const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Request a presigned URL for direct S3 upload
 */
export async function requestUploadUrl(
  params: RequestUploadUrlParams,
): Promise<RequestUploadUrlResult> {
  const { filename, contentType, size, userId } = params;
  let conversationId: string = params.conversationId || "";

  // Server-side size validation - reject before generating URL
  if (size > MAX_UPLOAD_SIZE_BYTES) {
    const maxMB = MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
    const requestedMB = (size / (1024 * 1024)).toFixed(2);
    throw new Error(`File size ${requestedMB}MB exceeds maximum allowed ${maxMB}MB`);
  }

  if (size <= 0) {
    throw new Error("Invalid file size");
  }

  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    throw new Error("Storage provider not configured");
  }

  // Create conversation if not provided
  let conversationStateId: string;
  if (!conversationId) {
    // Create new conversation and state
    const newState = await createConversationState({ values: { objective: "" } });
    conversationStateId = newState.id!;

    const newConversation = await createConversation({
      user_id: userId,
      conversation_state_id: conversationStateId,
    });
    conversationId = newConversation.id!;

    logger.info(
      { conversationId, conversationStateId },
      "created_new_conversation_for_upload",
    );
  } else {
    // Try to get existing conversation
    const { getConversation, updateConversation } = await import("../../db/operations");
    let conversation;
    try {
      conversation = await getConversation(conversationId);
    } catch (error) {
      // Conversation doesn't exist yet (happens when uploading before first message)
      conversation = null;
    }

    if (!conversation) {
      // Create the conversation with the provided ID
      logger.info(
        { conversationId, userId },
        "conversation_not_found_creating_for_upload",
      );

      // First ensure user exists (required for foreign key constraint)
      try {
        const user = await createUser({
          id: userId,
          username: `user_${userId.slice(0, 8)}`,
          email: `${userId}@temp.local`,
        });
        if (user) {
          logger.info({ userId }, "user_created_for_upload");
        }
      } catch (err: any) {
        // User might already exist - that's fine
        if (err.code !== "23505") {
          logger.error({ err, userId }, "create_user_failed_for_upload");
          throw err;
        }
      }

      // Create conversation state and conversation
      const newState = await createConversationState({ values: { objective: "" } });
      conversationStateId = newState.id!;

      await createConversation({
        id: conversationId,
        user_id: userId,
        conversation_state_id: conversationStateId,
      });

      logger.info(
        { conversationId, conversationStateId },
        "created_conversation_for_upload",
      );
    } else {
      // Verify ownership
      if (conversation.user_id !== userId) {
        throw new Error("Unauthorized: conversation belongs to different user");
      }
      conversationStateId = conversation.conversation_state_id || "";

      // If no state exists, create one
      if (!conversationStateId) {
        const newState = await createConversationState({ values: { objective: "" } });
        conversationStateId = newState.id!;
        await updateConversation(conversationId, {
          conversation_state_id: conversationStateId,
        });
      }
    }
  }

  // Generate unique file ID
  const fileId = generateUUID();

  // Build S3 key using conversationStateId (not conversationId)
  // This matches how analysis agents look up files
  const s3Key = getFileUploadPath(userId, conversationStateId, fileId, filename);

  // Generate presigned upload URL with size enforcement
  // S3 will REJECT uploads with different Content-Length than declared
  const uploadUrl = await storageProvider.getPresignedUploadUrl(
    s3Key,
    contentType || getMimeTypeFromFilename(filename),
    UPLOAD_URL_EXPIRATION,
    size, // Enforce exact file size - prevents uploading larger files
  );

  const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRATION * 1000).toISOString();

  // Create status record
  await createFileStatus({
    fileId,
    userId,
    conversationId,
    conversationStateId,
    s3Key,
    filename,
    contentType: contentType || getMimeTypeFromFilename(filename),
    size,
  });

  logger.info(
    { fileId, filename, s3Key, conversationId },
    "upload_url_generated",
  );

  return {
    fileId,
    uploadUrl,
    s3Key,
    expiresAt,
    conversationId,
    conversationStateId,
  };
}

/**
 * Confirm file upload and start processing
 * In-process mode: Processes synchronously
 * Queue mode: Enqueues job and returns immediately
 */
export async function confirmUpload(
  params: ConfirmUploadParams,
): Promise<ConfirmUploadResult> {
  const { fileId, userId } = params;

  logger.info({ fileId, userId }, "confirm_upload_started");

  // Get file status
  const status = await getFileStatus(fileId);
  if (!status) {
    logger.error({ fileId }, "confirm_file_status_not_found");
    throw new Error(`File not found: ${fileId}`);
  }

  logger.info({ fileId, statusUserId: status.userId, requestUserId: userId }, "confirm_status_found");

  if (status.userId !== userId) {
    logger.error({ fileId, statusUserId: status.userId, requestUserId: userId }, "confirm_user_mismatch");
    throw new Error("Unauthorized: file belongs to different user");
  }

  if (status.status !== "pending") {
    logger.error({ fileId, currentStatus: status.status }, "confirm_invalid_status");
    throw new Error(`Invalid file status: ${status.status}. Expected: pending`);
  }

  // Verify file exists in S3
  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    logger.error({ fileId }, "confirm_no_storage_provider");
    throw new Error("Storage provider not configured");
  }

  logger.info({ fileId, s3Key: status.s3Key }, "confirm_checking_s3_exists");

  const exists = await storageProvider.exists(status.s3Key);
  if (!exists) {
    logger.error({ fileId, s3Key: status.s3Key }, "confirm_file_not_in_s3");
    throw new Error("File not found in storage. Upload may not be complete.");
  }

  logger.info({ fileId }, "confirm_s3_check_passed");

  // Update status to uploaded
  await updateFileStatus(fileId, { status: "uploaded" });

  // Check if queue mode
  if (isJobQueueEnabled()) {
    // Queue mode: Enqueue processing job
    const { enqueueFileProcess } = await import("./queue");
    const jobId = await enqueueFileProcess(status);

    await updateFileStatus(fileId, { status: "processing", jobId });

    logger.info({ fileId, jobId }, "file_process_job_enqueued");

    return {
      fileId,
      status: "processing",
      filename: status.filename,
      size: status.size,
      jobId,
    };
  } else {
    // In-process mode: Process synchronously
    const result = await processFile(status);

    return {
      fileId,
      status: "ready",
      filename: status.filename,
      size: status.size,
      description: result.description,
    };
  }
}

/**
 * Process a file: generate description and update conversation state
 * Used by both in-process mode and queue worker
 */
export async function processFile(
  status: FileStatusRecord,
): Promise<{ description: string }> {
  const { fileId, s3Key, filename, contentType, conversationStateId, size } = status;

  logger.info({ fileId, filename, size }, "processing_file");

  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    throw new Error("Storage provider not configured");
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const isPDF = ext === "pdf" || contentType === "application/pdf";
  const isImage = contentType.startsWith("image/");
  const isExcel = ["xlsx", "xls"].includes(ext || "");
  const isText = contentType.startsWith("text/") ||
    ["csv", "json", "md", "txt", "tsv", "xml", "yaml", "yml"].includes(ext || "");

  // Download full file for types that need complete content
  // - PDFs: need full file for text extraction
  // - Images: need full file for OCR
  // - Excel: need full file for sheet extraction
  // - Text files: need full content for analysis
  let preview = "";
  try {
    let previewBuffer: Buffer;
    const needsFullFile = isPDF || isImage || isExcel || isText;

    if (needsFullFile) {
      // Limit based on file type to prevent memory issues
      const maxFileSize = isPDF || isImage || isExcel ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB for PDF/image/Excel, 10MB for text
      if (size > maxFileSize) {
        logger.warn({ fileId, filename, size, maxFileSize }, "file_too_large_for_full_download");
        previewBuffer = await storageProvider.downloadRange(s3Key, 0, maxFileSize - 1);
      } else {
        previewBuffer = await storageProvider.download(s3Key);
      }
      const fileType = isPDF ? "pdf" : isImage ? "image" : "text";
      logger.info({ fileId, filename, downloadedBytes: previewBuffer.length, type: fileType }, "full_file_downloaded");
    } else {
      // For unknown/binary files, just download preview
      previewBuffer = await storageProvider.downloadRange(s3Key, 0, PREVIEW_SIZE - 1);
      logger.info({ fileId, filename, previewBytes: previewBuffer.length }, "preview_downloaded");
    }

    preview = await parseFilePreview(previewBuffer, filename, contentType);
  } catch (error) {
    logger.warn({ fileId, error }, "failed_to_download_file");
    preview = `[File: ${filename}]`;
  }

  // Generate AI description
  const description = await generateFileDescription(filename, contentType, preview);

  // Log file being stored (content NOT saved to Supabase - files accessed via S3 path)
  logger.info({
    fileId,
    filename,
    previewLength: preview.length,
  }, "file_processed_for_storage");

  // Update conversation state (no content - deep research accesses files via S3)
  // Use relative path (uploads/filename) instead of full S3 key
  await addFileToConversationState(conversationStateId, {
    id: fileId,
    filename,
    description,
    path: getUploadPath(filename),
  });

  // Update status to ready
  await updateFileStatus(fileId, { status: "ready", description });

  logger.info({ fileId, filename, description }, "file_processed");

  return { description };
}

/**
 * Add file to conversation state uploadedDatasets
 * Uses Redis lock to prevent race conditions during concurrent uploads
 */
async function addFileToConversationState(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string; content?: string },
): Promise<void> {
  const { isJobQueueEnabled } = await import("../queue/connection");

  if (isJobQueueEnabled()) {
    // Use Redis lock for concurrent safety
    await addFileWithLock(conversationStateId, file);
  } else {
    // In-process mode: no concurrency issues
    await addFileDirectly(conversationStateId, file);
  }
}

/**
 * Add file with Redis distributed lock (queue mode)
 */
async function addFileWithLock(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string; content?: string },
): Promise<void> {
  const { getBullMQConnection } = await import("../queue/connection");
  const redis = getBullMQConnection();

  const lockKey = `lock:conversation_state:${conversationStateId}`;
  const lockTTL = 30; // 30 seconds max lock time
  const maxRetries = 10;
  const retryDelay = 100; // 100ms between retries

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Try to acquire lock using SET NX (only set if not exists)
    const acquired = await redis.set(lockKey, "1", "EX", lockTTL, "NX");

    if (acquired) {
      try {
        // Lock acquired - safe to read-modify-write
        await addFileDirectly(conversationStateId, file);
        return;
      } finally {
        // Always release lock
        await redis.del(lockKey);
      }
    }

    // Lock not acquired, wait and retry
    logger.debug(
      { conversationStateId, fileId: file.id, attempt },
      "file_add_waiting_for_lock",
    );
    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
  }

  throw new Error(
    `Failed to acquire lock for conversation state ${conversationStateId} after ${maxRetries} attempts`,
  );
}

/**
 * Add file directly without locking (used when lock is held or in-process mode)
 */
async function addFileDirectly(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string; content?: string },
): Promise<void> {
  const state = await getConversationState(conversationStateId);
  if (!state) {
    throw new Error(`Conversation state not found: ${conversationStateId}`);
  }

  const existingDatasets = state.values.uploadedDatasets || [];

  // Check if file already exists by ID
  if (existingDatasets.some((f: any) => f.id === file.id)) {
    logger.info(
      { conversationStateId, fileId: file.id, filename: file.filename },
      "file_already_in_conversation_state_skipping",
    );
    return;
  }

  // Build new array: new file first, then existing (excluding same filename)
  const uploadedDatasets = [
    { ...file, uploadedAt: new Date().toISOString() },
    ...existingDatasets.filter((f: any) => f.filename !== file.filename),
  ];

  await updateConversationState(
    conversationStateId,
    { ...state.values, uploadedDatasets },
    { preserveUploadedDatasets: false }, // Allow file operations to update uploadedDatasets
  );

  logger.info(
    { conversationStateId, fileId: file.id, filename: file.filename },
    "file_added_to_conversation_state",
  );
}

/**
 * Get file status for a user
 */
export async function getFileStatusForUser(
  fileId: string,
  userId: string,
): Promise<FileStatusRecord | null> {
  const status = await getFileStatus(fileId);

  if (!status) {
    return null;
  }

  if (status.userId !== userId) {
    return null;
  }

  return status;
}

/**
 * Delete a file
 */
export async function deleteFile(fileId: string, userId: string): Promise<void> {
  const status = await getFileStatus(fileId);

  if (!status) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (status.userId !== userId) {
    throw new Error("Unauthorized: file belongs to different user");
  }

  const storageProvider = getStorageProvider();

  // Delete from S3 if exists
  if (storageProvider) {
    try {
      await storageProvider.delete(status.s3Key);
      logger.info({ fileId, s3Key: status.s3Key }, "file_deleted_from_s3");
    } catch (error) {
      logger.warn({ fileId, error }, "failed_to_delete_file_from_s3");
    }
  }

  // Remove from conversation state
  try {
    const state = await getConversationState(status.conversationStateId);
    if (state && state.values.uploadedDatasets) {
      const uploadedDatasets = state.values.uploadedDatasets.filter(
        (f: any) => f.id !== fileId,
      );
      await updateConversationState(
        status.conversationStateId,
        { ...state.values, uploadedDatasets },
        { preserveUploadedDatasets: false }, // Allow file deletion to update uploadedDatasets
      );
    }
  } catch (error) {
    logger.warn({ fileId, error }, "failed_to_remove_file_from_state");
  }

  // Delete status record
  await deleteFileStatus(fileId);

  logger.info({ fileId }, "file_deleted");
}
