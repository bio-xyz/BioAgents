import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import logger from "../../utils/logger";
import type { StorageProvider } from "../types";

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    endpoint?: string;
  }) {
    this.bucket = config.bucket;

    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
    });

    if (logger) {
      logger.info(`S3 Storage Provider initialized for bucket: ${this.bucket}`);
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

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      if (logger) {
        logger.error(`Failed to download file from S3: ${path}`, error as any);
      }
      throw new Error(`S3 download failed: ${(error as Error).message}`);
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
}
