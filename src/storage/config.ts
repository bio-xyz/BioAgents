/**
 * Storage configuration from environment variables
 *
 * Environment variables:
 * - STORAGE_PROVIDER: 's3' (optional, if not set, files won't be uploaded to cloud storage)
 *
 * For S3:
 * - AWS_ACCESS_KEY_ID or S3_ACCESS_KEY_ID: S3 access key
 * - AWS_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY: S3 secret key
 * - AWS_REGION or S3_REGION: S3 region (default: 'us-east-1')
 * - S3_BUCKET: S3 bucket name (required)
 * - S3_ENDPOINT: Custom S3 endpoint (optional, for S3-compatible services)
 */
export const STORAGE_CONFIG = {
  provider: process.env.STORAGE_PROVIDER?.toLowerCase(),
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET,
    endpoint: process.env.S3_ENDPOINT,
  },
};
