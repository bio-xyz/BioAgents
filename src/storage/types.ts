/**
 * Storage Provider Interface
 * Defines the contract for file storage backends (S3, Azure, etc.)
 */
import { getConversationBasePath, getUploadPath } from "../storage";
import logger from "../utils/logger";

export abstract class StorageProvider {
  /**
   * Upload a file to storage
   * @param path - The path where the file should be stored
   * @param buffer - The file content as a Buffer
   * @param mimeType - The MIME type of the file
   * @returns The URL or key of the uploaded file
   */
  abstract upload(
    path: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string>;

  /**
   * Download a file from storage
   * @param path - The path of the file to download
   * @returns The file content as a Buffer
   */
  abstract download(path: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param path - The path of the file to delete
   */
  abstract delete(path: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param path - The path of the file to check
   */
  abstract exists(path: string): Promise<boolean>;

  /**
   * Generate a presigned URL for downloading a file
   * @param path - The path of the file
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @param filename - Optional filename for Content-Disposition header (forces download)
   * @returns A presigned URL for downloading the file
   */
  abstract getPresignedUrl(
    path: string,
    expiresIn?: number,
    filename?: string,
  ): Promise<string>;

  /**
   * Download a file from a user's conversation storage
   * @param userId - ID of the user
   * @param conversationStateId - ID of the conversation state
   * @param filename - Name of the file to fetch
   * @returns
   */
  async fetchFileFromUserStorage(
    userId: string,
    conversationStateId: string,
    filename: string,
  ): Promise<Buffer> {
    const basePath = getConversationBasePath(userId, conversationStateId);
    const uploadPath = getUploadPath(filename);
    const fullPath = `${basePath}/${uploadPath}`;

    logger.info({ filename, fullPath }, "fetching_file_from_storage");

    return await this.download(fullPath);
  }

  /**
   * Get a presigned URL for a file in a user's conversation storage
   * @param userId - ID of the user
   * @param conversationStateId - ID of the conversation state
   * @param relativePath - Relative path of the file within the conversation storage
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @returns A presigned URL for downloading the file
   */
  async getPresignedUrlForConversationFile(
    userId: string,
    conversationStateId: string,
    relativePath: string,
    expiresIn?: number,
  ): Promise<string> {
    const basePath = getConversationBasePath(userId, conversationStateId);
    const fullPath = `${basePath}/${relativePath}`;

    logger.info({ relativePath, fullPath }, "generating_presigned_url");

    return await this.getPresignedUrl(fullPath, expiresIn);
  }
}

export interface StorageConfig {
  provider: "s3";
  s3?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    endpoint?: string; // Optional for S3-compatible services
  };
}
