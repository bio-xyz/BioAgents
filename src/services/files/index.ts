/**
 * File Service
 * Handles file upload URL generation, confirmation, and processing
 */

import {
  createConversation,
  createConversationState,
  createUser,
  type DbConversationState,
  getConversationState,
  updateConversationState,
} from "../../db/operations";
import {
  getFileUploadPath,
  getMimeTypeFromFilename,
  getStorageProvider,
  getUploadPath,
} from "../../storage";
import logger from "../../utils/logger";
import { generateUUID } from "../../utils/uuid";
import { isJobQueueEnabled } from "../queue/connection";
import { generateFileDescription, parseFilePreview } from "./description";
import { type PersistedMessageFileMetadata, resolveDownloadableFileMetadata } from "./download-url";
import {
  createFileStatus,
  deleteFileStatus,
  type FileStatusRecord,
  getFileStatus,
  updateFileStatus,
} from "./status";

export type {
  DownloadableFileMetadata,
  PersistedMessageFileMetadata,
} from "./download-url";
export { resolveDownloadableFileMetadata } from "./download-url";

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

export interface FileDownloadUrlResult {
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  expiresAt: number;
}

// Maximum file size: 2GB
const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Request a presigned URL for direct S3 upload
 */
export async function requestUploadUrl(
  params: RequestUploadUrlParams
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
      conversation_state_id: conversationStateId,
      user_id: userId,
    });
    conversationId = newConversation.id!;

    logger.info({ conversationId, conversationStateId }, "created_new_conversation_for_upload");
  } else {
    // Try to get existing conversation
    const { getConversation, updateConversation } = await import("../../db/operations");
    let conversation;
    try {
      conversation = await getConversation(conversationId);
    } catch (error) {
      // Expected when uploading before first message; log so genuine DB failures stay observable.
      logger.debug({ conversationId, error }, "getConversation_failed_treating_as_missing");
      conversation = null;
    }

    if (!conversation) {
      // Create the conversation with the provided ID
      logger.info({ conversationId, userId }, "conversation_not_found_creating_for_upload");

      // First ensure user exists (required for foreign key constraint)
      try {
        const user = await createUser({
          email: `${userId}@temp.local`,
          id: userId,
          username: `user_${userId.slice(0, 8)}`,
        });
        if (user) {
          logger.info({ userId }, "user_created_for_upload");
        }
      } catch (err: unknown) {
        // User might already exist - that's fine
        const errCode = err && typeof err === "object" && "code" in err ? err.code : undefined;
        if (errCode !== "23505") {
          logger.error({ err, userId }, "create_user_failed_for_upload");
          throw err;
        }
      }

      // Create conversation state and conversation
      const newState = await createConversationState({ values: { objective: "" } });
      conversationStateId = newState.id!;

      await createConversation({
        conversation_state_id: conversationStateId,
        id: conversationId,
        user_id: userId,
      });

      logger.info({ conversationId, conversationStateId }, "created_conversation_for_upload");
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
    size // Enforce exact file size - prevents uploading larger files
  );

  const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRATION * 1000).toISOString();

  // Create status record
  await createFileStatus({
    contentType: contentType || getMimeTypeFromFilename(filename),
    conversationId,
    conversationStateId,
    fileId,
    filename,
    s3Key,
    size,
    userId,
  });

  logger.info({ conversationId, fileId, filename, s3Key }, "upload_url_generated");

  return {
    conversationId,
    conversationStateId,
    expiresAt,
    fileId,
    s3Key,
    uploadUrl,
  };
}

/**
 * Confirm file upload and start processing
 * In-process mode: Processes synchronously
 * Queue mode: Enqueues job and returns immediately
 */
export async function confirmUpload(params: ConfirmUploadParams): Promise<ConfirmUploadResult> {
  const { fileId, userId } = params;

  logger.info({ fileId, userId }, "confirm_upload_started");

  // Get file status
  const status = await getFileStatus(fileId);
  if (!status) {
    logger.error({ fileId }, "confirm_file_status_not_found");
    throw new Error(`File not found: ${fileId}`);
  }

  logger.info(
    { fileId, requestUserId: userId, statusUserId: status.userId },
    "confirm_status_found"
  );

  if (status.userId !== userId) {
    logger.error(
      { fileId, requestUserId: userId, statusUserId: status.userId },
      "confirm_user_mismatch"
    );
    throw new Error("Unauthorized: file belongs to different user");
  }

  if (status.status !== "pending") {
    logger.error({ currentStatus: status.status, fileId }, "confirm_invalid_status");
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

    await updateFileStatus(fileId, { jobId, status: "processing" });

    logger.info({ fileId, jobId }, "file_process_job_enqueued");

    return {
      fileId,
      filename: status.filename,
      jobId,
      size: status.size,
      status: "processing",
    };
  } else {
    // In-process mode: Process synchronously
    const result = await processFile(status);

    return {
      description: result.description,
      fileId,
      filename: status.filename,
      size: status.size,
      status: "ready",
    };
  }
}

/**
 * Process a file: generate description and update conversation state
 * Used by both in-process mode and queue worker
 */
export async function processFile(status: FileStatusRecord): Promise<{ description: string }> {
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
  const isText =
    contentType.startsWith("text/") ||
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
        logger.warn({ fileId, filename, maxFileSize, size }, "file_too_large_for_full_download");
        previewBuffer = await storageProvider.downloadRange(s3Key, 0, maxFileSize - 1);
      } else {
        previewBuffer = await storageProvider.download(s3Key);
      }
      const fileType = isPDF ? "pdf" : isImage ? "image" : "text";
      logger.info(
        { downloadedBytes: previewBuffer.length, fileId, filename, type: fileType },
        "full_file_downloaded"
      );
    } else {
      // For unknown/binary files, just download preview
      previewBuffer = await storageProvider.downloadRange(s3Key, 0, PREVIEW_SIZE - 1);
      logger.info({ fileId, filename, previewBytes: previewBuffer.length }, "preview_downloaded");
    }

    preview = await parseFilePreview(previewBuffer, filename, contentType);
  } catch (error) {
    logger.warn({ error, fileId }, "failed_to_download_file");
    preview = `[File: ${filename}]`;
  }

  // Generate AI description
  const description = await generateFileDescription(filename, contentType, preview);

  // Log file being stored (content NOT saved to Supabase - files accessed via S3 path)
  logger.info(
    {
      fileId,
      filename,
      previewLength: preview.length,
    },
    "file_processed_for_storage"
  );

  // Update conversation state (no content - deep research accesses files via S3)
  // Use relative path (uploads/filename) instead of full S3 key
  await addFileToConversationState(conversationStateId, {
    description,
    filename,
    id: fileId,
    path: getUploadPath(filename),
  });

  // Update status to ready
  await updateFileStatus(fileId, { description, status: "ready" });

  logger.info({ description, fileId, filename }, "file_processed");

  return { description };
}

/**
 * Add file to conversation state uploadedDatasets
 * Uses Redis lock to prevent race conditions during concurrent uploads
 */
async function addFileToConversationState(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string; content?: string }
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
  file: { id: string; filename: string; description: string; path: string; content?: string }
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
    logger.debug({ attempt, conversationStateId, fileId: file.id }, "file_add_waiting_for_lock");
    await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
  }

  throw new Error(
    `Failed to acquire lock for conversation state ${conversationStateId} after ${maxRetries} attempts`
  );
}

/**
 * Add file directly without locking (used when lock is held or in-process mode)
 */
async function addFileDirectly(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string; content?: string }
): Promise<void> {
  const state: DbConversationState | null = await getConversationState(conversationStateId);
  if (!state) {
    throw new Error(`Conversation state not found: ${conversationStateId}`);
  }

  const existingDatasets = state.values.uploadedDatasets || [];

  // Check if file already exists by ID
  if (existingDatasets.some((f) => f.id === file.id)) {
    logger.info(
      { conversationStateId, fileId: file.id, filename: file.filename },
      "file_already_in_conversation_state_skipping"
    );
    return;
  }

  // Build new array: new file first, then existing (excluding same filename)
  const uploadedDatasets = [
    { ...file, uploadedAt: new Date().toISOString() },
    ...existingDatasets.filter((f) => f.filename !== file.filename),
  ];

  await updateConversationState(
    conversationStateId,
    { ...state.values, uploadedDatasets },
    { preserveUploadedDatasets: false } // Allow file operations to update uploadedDatasets
  );

  logger.info(
    { conversationStateId, fileId: file.id, filename: file.filename },
    "file_added_to_conversation_state"
  );
}

/**
 * Get file status for a user
 */
export async function getFileStatusForUser(
  fileId: string,
  userId: string
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

async function findPersistedMessageFileForUser(
  fileId: string,
  userId: string
): Promise<PersistedMessageFileMetadata | null> {
  const { getServiceClient } = await import("../../db/client");
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .select("files")
    .eq("user_id", userId)
    .contains("files", [{ fileId }])
    .limit(10);

  if (error) {
    logger.warn({ error, fileId, userId }, "file_download_persisted_metadata_lookup_failed");
    return null;
  }

  for (const row of data || []) {
    const files = (row as { files?: unknown }).files;
    if (!Array.isArray(files)) continue;

    const match = files.find((file): file is PersistedMessageFileMetadata => {
      if (typeof file !== "object" || file === null) return false;
      const raw = file as Record<string, unknown>;
      return (
        raw.fileId === fileId &&
        typeof raw.fileKey === "string" &&
        typeof raw.name === "string" &&
        typeof raw.size === "number" &&
        typeof raw.type === "string"
      );
    });
    if (match) return match;
  }

  return null;
}

export async function getFileDownloadUrlForUser(
  fileId: string,
  userId: string
): Promise<FileDownloadUrlResult | null> {
  const status = await getFileStatusForUser(fileId, userId);
  const persistedFile = status ? null : await findPersistedMessageFileForUser(fileId, userId);
  const metadata = resolveDownloadableFileMetadata({ persistedFile, status });
  if (!metadata) return null;

  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    throw new Error("Storage provider is not configured");
  }

  const expiresInSeconds = 3600;
  const url = await storageProvider.getPresignedUrl(
    metadata.fileKey,
    expiresInSeconds,
    metadata.filename
  );

  return {
    contentType: metadata.contentType,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    fileId: metadata.fileId,
    filename: metadata.filename,
    size: metadata.size,
    url,
  };
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
      logger.warn({ error, fileId }, "failed_to_delete_file_from_s3");
    }
  }

  // Remove from conversation state
  try {
    const state: DbConversationState | null = await getConversationState(
      status.conversationStateId
    );
    if (state && state.values.uploadedDatasets) {
      const uploadedDatasets = state.values.uploadedDatasets.filter((f) => f.id !== fileId);
      await updateConversationState(
        status.conversationStateId,
        { ...state.values, uploadedDatasets },
        { preserveUploadedDatasets: false } // Allow file deletion to update uploadedDatasets
      );
    }
  } catch (error) {
    logger.warn({ error, fileId }, "failed_to_remove_file_from_state");
  }

  // Delete status record
  await deleteFileStatus(fileId);

  logger.info({ fileId }, "file_deleted");
}
