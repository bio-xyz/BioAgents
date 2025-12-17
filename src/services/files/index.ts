/**
 * File Service
 * Handles file upload URL generation, confirmation, and processing
 */

import {
  getConversationState,
  updateConversationState,
  createConversation,
  createConversationState,
} from "../../db/operations";
import {
  getFileUploadPath,
  getStorageProvider,
  getMimeTypeFromFilename,
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

// Maximum file size: 500MB (same as MAX_FILE_SIZE_MB in fileUpload config)
const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

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
    // Get existing conversation state
    const { getConversation } = await import("../../db/operations");
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    if (conversation.user_id !== userId) {
      throw new Error("Unauthorized: conversation belongs to different user");
    }
    conversationStateId = conversation.conversation_state_id || "";

    // If no state exists, create one
    if (!conversationStateId) {
      const newState = await createConversationState({ values: { objective: "" } });
      conversationStateId = newState.id!;
      const { updateConversation } = await import("../../db/operations");
      await updateConversation(conversationId, {
        conversation_state_id: conversationStateId,
      });
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

  // Get file status
  const status = await getFileStatus(fileId);
  if (!status) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (status.userId !== userId) {
    throw new Error("Unauthorized: file belongs to different user");
  }

  if (status.status !== "pending") {
    throw new Error(`Invalid file status: ${status.status}. Expected: pending`);
  }

  // Verify file exists in S3
  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    throw new Error("Storage provider not configured");
  }

  const exists = await storageProvider.exists(status.s3Key);
  if (!exists) {
    throw new Error("File not found in storage. Upload may not be complete.");
  }

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
  const { fileId, s3Key, filename, contentType, conversationStateId } = status;

  logger.info({ fileId, filename }, "processing_file");

  const storageProvider = getStorageProvider();
  if (!storageProvider) {
    throw new Error("Storage provider not configured");
  }

  // Download preview for description generation
  let preview = "";
  try {
    const buffer = await storageProvider.download(s3Key);
    const previewBuffer = buffer.slice(0, PREVIEW_SIZE);
    preview = await parseFilePreview(previewBuffer, filename, contentType);
  } catch (error) {
    logger.warn({ fileId, error }, "failed_to_download_preview");
    preview = `[File: ${filename}]`;
  }

  // Generate AI description
  const description = await generateFileDescription(filename, contentType, preview);

  // Update conversation state
  await addFileToConversationState(conversationStateId, {
    id: fileId,
    filename,
    description,
    path: s3Key,
  });

  // Update status to ready
  await updateFileStatus(fileId, { status: "ready", description });

  logger.info({ fileId, filename, description }, "file_processed");

  return { description };
}

/**
 * Add file to conversation state uploadedDatasets
 */
async function addFileToConversationState(
  conversationStateId: string,
  file: { id: string; filename: string; description: string; path: string },
): Promise<void> {
  const state = await getConversationState(conversationStateId);
  if (!state) {
    throw new Error(`Conversation state not found: ${conversationStateId}`);
  }

  const existingDatasets = state.values.uploadedDatasets || [];

  // Replace if same filename exists, otherwise append
  const uploadedDatasets = [
    ...existingDatasets.filter((f: any) => f.filename !== file.filename),
    file,
  ];

  await updateConversationState(conversationStateId, {
    ...state.values,
    uploadedDatasets,
  });

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
      await updateConversationState(status.conversationStateId, {
        ...state.values,
        uploadedDatasets,
      });
    }
  } catch (error) {
    logger.warn({ fileId, error }, "failed_to_remove_file_from_state");
  }

  // Delete status record
  await deleteFileStatus(fileId);

  logger.info({ fileId }, "file_deleted");
}
