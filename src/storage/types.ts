/**
 * Storage Provider Interface
 * Defines the contract for file storage backends (S3, Azure, etc.)
 */

export interface StorageProvider {
  /**
   * Upload a file to storage
   * @param path - The path where the file should be stored
   * @param buffer - The file content as a Buffer
   * @param mimeType - The MIME type of the file
   * @returns The URL or key of the uploaded file
   */
  upload(path: string, buffer: Buffer, mimeType: string): Promise<string>;

  /**
   * Download a file from storage
   * @param path - The path of the file to download
   * @returns The file content as a Buffer
   */
  download(path: string): Promise<Buffer>;

  /**
   * Delete a file from storage
   * @param path - The path of the file to delete
   */
  delete(path: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param path - The path of the file to check
   */
  exists(path: string): Promise<boolean>;
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
