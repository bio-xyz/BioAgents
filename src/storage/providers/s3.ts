import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import logger from "../../utils/logger";
import { StorageProvider } from "../types";

export class S3StorageProvider extends StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    endpoint?: string;
  }) {
    super();
    this.bucket = config.bucket;

    // For S3-compatible services (DigitalOcean Spaces, MinIO, Cloudflare R2),
    // we need to disable automatic checksum calculation as they don't support it
    const isS3Compatible = !!config.endpoint;

    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      // Disable SDK checksum features for S3-compatible services
      // This prevents x-amz-checksum-* headers that cause CORS/compatibility issues
      ...(isS3Compatible && {
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    });

    if (logger) {
      logger.info(
        `S3 Storage Provider initialized for bucket: ${this.bucket}${isS3Compatible ? " (S3-compatible mode)" : ""}`,
      );
    }
  }

  async upload(
    path: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: buffer,
        ContentType: mimeType,
      });

      await this.client.send(command);

      if (logger) {
        logger.info(`Successfully uploaded file to S3: ${path}`);
      }

      return path;
    } catch (error) {
      if (logger) {
        logger.error(`Failed to upload file to S3: ${path}`, error as any);
      }
      throw new Error(`S3 upload failed: ${(error as Error).message}`);
    }
  }

  async download(path: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error("No data received from S3");
      }

      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (error: any) {
      if (logger) {
        logger.error(
          {
            path,
            bucket: this.bucket,
            errorName: error?.name,
            errorCode: error?.$metadata?.httpStatusCode,
            errorMessage: error?.message,
          },
          "s3_download_failed",
        );
      }
      throw new Error(`S3 download failed: ${error?.name || "UnknownError"} - ${path}`);
    }
  }

  /**
   * Download only a range of bytes from a file (efficient for previews)
   * @param path - S3 key
   * @param start - Start byte (0-indexed)
   * @param end - End byte (inclusive)
   */
  async downloadRange(path: string, start: number, end: number): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Range: `bytes=${start}-${end}`,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error("No data received from S3");
      }

      const byteArray = await response.Body.transformToByteArray();

      if (logger) {
        logger.info(
          { path, requestedRange: `${start}-${end}`, receivedBytes: byteArray.length },
          "s3_range_download_success",
        );
      }

      return Buffer.from(byteArray);
    } catch (error: any) {
      if (logger) {
        logger.error(
          {
            path,
            bucket: this.bucket,
            range: `${start}-${end}`,
            errorName: error?.name,
            errorCode: error?.$metadata?.httpStatusCode,
            errorMessage: error?.message,
          },
          "s3_range_download_failed",
        );
      }
      throw new Error(`S3 range download failed: ${error?.name || "UnknownError"} - ${path}`);
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: path,
      });

      await this.client.send(command);

      if (logger) {
        logger.info(`Successfully deleted file from S3: ${path}`);
      }
    } catch (error) {
      if (logger) {
        logger.error(`Failed to delete file from S3: ${path}`, error as any);
      }
      throw new Error(`S3 delete failed: ${(error as Error).message}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: path,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }

      if (logger) {
        logger.error(`Failed to check file existence in S3: ${path}`, error);
      }
      throw new Error(`S3 exists check failed: ${error.message}`);
    }
  }

  async getPresignedUrl(
    path: string,
    expiresIn: number = 3600,
    filename?: string,
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path,
        ...(filename && {
          ResponseContentDisposition: `attachment; filename="${filename}"`,
        }),
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });

      if (logger) {
        logger.info(
          `Generated presigned URL for S3: ${path}, expires in ${expiresIn}s`,
        );
      }

      return url;
    } catch (error) {
      if (logger) {
        logger.error(
          `Failed to generate presigned URL for S3: ${path}`,
          error as any,
        );
      }
      throw new Error(
        `S3 presigned URL generation failed: ${(error as Error).message}`,
      );
    }
  }

  async getPresignedUploadUrl(
    path: string,
    contentType: string,
    expiresIn: number = 3600,
    contentLength?: number,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        ContentType: contentType,
        // When ContentLength is included, S3 will REJECT uploads with different size
        // This prevents abuse: user cannot upload 5GB using a URL signed for 50MB
        ...(contentLength && { ContentLength: contentLength }),
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });

      if (logger) {
        logger.info(
          {
            path,
            expiresIn,
            contentLength: contentLength || "not enforced",
          },
          "presigned_upload_url_generated",
        );
      }

      return url;
    } catch (error) {
      if (logger) {
        logger.error(
          `Failed to generate presigned upload URL for S3: ${path}`,
          error as any,
        );
      }
      throw new Error(
        `S3 presigned upload URL generation failed: ${(error as Error).message}`,
      );
    }
  }
}
