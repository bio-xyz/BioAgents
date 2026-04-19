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

interface S3ErrorLike {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

function isS3ErrorLike(error: unknown): error is S3ErrorLike {
  return typeof error === "object" && error !== null;
}

function s3ErrorFields(error: unknown): {
  name?: string;
  message?: string;
  httpStatusCode?: number;
} {
  if (!isS3ErrorLike(error)) return {};
  const name = typeof error.name === "string" ? error.name : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;
  const metadata = error.$metadata;
  const httpStatusCode =
    metadata && typeof metadata === "object" && typeof metadata.httpStatusCode === "number"
      ? metadata.httpStatusCode
      : undefined;
  return { httpStatusCode, message, name };
}

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
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: config.region,
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
        `S3 Storage Provider initialized for bucket: ${this.bucket}${isS3Compatible ? " (S3-compatible mode)" : ""}`
      );
    }
  }

  async upload(path: string, buffer: Buffer, mimeType: string): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Body: buffer,
        Bucket: this.bucket,
        ContentType: mimeType,
        Key: path,
      });

      await this.client.send(command);

      if (logger) {
        logger.info(`Successfully uploaded file to S3: ${path}`);
      }

      return path;
    } catch (error) {
      if (logger) {
        logger.error({ err: error }, `Failed to upload file to S3: ${path}`);
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
    } catch (error: unknown) {
      const fields = s3ErrorFields(error);
      if (logger) {
        logger.error(
          {
            bucket: this.bucket,
            errorCode: fields.httpStatusCode,
            errorMessage: fields.message,
            errorName: fields.name,
            path,
          },
          "s3_download_failed"
        );
      }
      throw new Error(`S3 download failed: ${fields.name || "UnknownError"} - ${path}`);
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
          { path, receivedBytes: byteArray.length, requestedRange: `${start}-${end}` },
          "s3_range_download_success"
        );
      }

      return Buffer.from(byteArray);
    } catch (error: unknown) {
      const fields = s3ErrorFields(error);
      if (logger) {
        logger.error(
          {
            bucket: this.bucket,
            errorCode: fields.httpStatusCode,
            errorMessage: fields.message,
            errorName: fields.name,
            path,
            range: `${start}-${end}`,
          },
          "s3_range_download_failed"
        );
      }
      throw new Error(`S3 range download failed: ${fields.name || "UnknownError"} - ${path}`);
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
        logger.error({ err: error }, `Failed to delete file from S3: ${path}`);
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
    } catch (error: unknown) {
      const fields = s3ErrorFields(error);
      if (fields.name === "NotFound" || fields.httpStatusCode === 404) {
        return false;
      }

      if (logger) {
        logger.error({ err: error }, `Failed to check file existence in S3: ${path}`);
      }
      const errMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`S3 exists check failed: ${errMessage}`);
    }
  }

  async getPresignedUrl(
    path: string,
    expiresIn: number = 3600,
    filename?: string
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
        logger.info(`Generated presigned URL for S3: ${path}, expires in ${expiresIn}s`);
      }

      return url;
    } catch (error) {
      if (logger) {
        logger.error({ err: error }, `Failed to generate presigned URL for S3: ${path}`);
      }
      throw new Error(`S3 presigned URL generation failed: ${(error as Error).message}`);
    }
  }

  async getPresignedUploadUrl(
    path: string,
    contentType: string,
    expiresIn: number = 3600,
    contentLength?: number
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        ContentType: contentType,
        Key: path,
        // When ContentLength is included, S3 will REJECT uploads with different size
        // This prevents abuse: user cannot upload 5GB using a URL signed for 50MB
        ...(contentLength && { ContentLength: contentLength }),
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });

      if (logger) {
        logger.info(
          {
            contentLength: contentLength || "not enforced",
            expiresIn,
            path,
          },
          "presigned_upload_url_generated"
        );
      }

      return url;
    } catch (error) {
      if (logger) {
        logger.error({ err: error }, `Failed to generate presigned upload URL for S3: ${path}`);
      }
      throw new Error(`S3 presigned upload URL generation failed: ${(error as Error).message}`);
    }
  }
}
