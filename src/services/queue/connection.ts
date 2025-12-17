/**
 * Redis Connection Manager for BullMQ Job Queue
 *
 * Provides Redis connections for:
 * - BullMQ queues and workers
 * - Pub/Sub for real-time notifications
 *
 * Note: BullMQ requires ioredis, so we use it for all Redis connections
 * for consistency. Pub/Sub requires separate connections (Redis limitation).
 */

import Redis from "ioredis";
import logger from "../../utils/logger";

/**
 * Get Redis URL from environment
 * Supports REDIS_URL or individual REDIS_HOST/PORT/PASSWORD
 */
function getRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST || "localhost";
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD;

  if (password) {
    return `redis://:${password}@${host}:${port}`;
  }

  return `redis://${host}:${port}`;
}

// Connection instances (lazy initialized)
let bullmqConnection: Redis | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

/**
 * Get BullMQ connection (for queues and workers)
 * Requires maxRetriesPerRequest: null for BullMQ
 */
export function getBullMQConnection(): Redis {
  if (!bullmqConnection) {
    const redisUrl = getRedisUrl();

    bullmqConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      retryStrategy: (times) => {
        if (times > 10) return null; // Stop after 10 retries
        return Math.min(times * 200, 5000); // Exponential backoff, max 5s
      },
      reconnectOnError: (err) => {
        const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    bullmqConnection.on("error", (err) => {
      logger.error({ err }, "bullmq_redis_connection_error");
    });

    bullmqConnection.on("connect", () => {
      logger.info("bullmq_redis_connected");
    });
  }

  return bullmqConnection;
}

/**
 * Get Redis publisher for Pub/Sub notifications
 * Workers use this to send notifications to the API server
 */
export function getPublisher(): Redis {
  if (!publisher) {
    const redisUrl = getRedisUrl();

    publisher = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 200, 5000);
      },
    });

    publisher.on("error", (err) => {
      logger.error({ err }, "redis_publisher_error");
    });

    publisher.on("connect", () => {
      logger.info("redis_publisher_connected");
    });
  }

  return publisher;
}

/**
 * Get Redis subscriber for Pub/Sub notifications
 * API server uses this to receive notifications from workers
 * Note: Subscriber needs separate connection - Redis limitation
 */
export function getSubscriber(): Redis {
  if (!subscriber) {
    const redisUrl = getRedisUrl();

    subscriber = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 200, 5000);
      },
    });

    subscriber.on("error", (err) => {
      logger.error({ err }, "redis_subscriber_error");
    });

    subscriber.on("connect", () => {
      logger.info("redis_subscriber_connected");
    });
  }

  return subscriber;
}

/**
 * Check if job queue is enabled via environment variable
 */
export function isJobQueueEnabled(): boolean {
  return process.env.USE_JOB_QUEUE === "true";
}

/**
 * Close all Redis connections (for graceful shutdown)
 */
export async function closeConnections(): Promise<void> {
  const connections = [bullmqConnection, publisher, subscriber];

  await Promise.all(
    connections
      .filter((conn): conn is Redis => conn !== null)
      .map((conn) => conn.quit()),
  );

  bullmqConnection = null;
  publisher = null;
  subscriber = null;

  logger.info("redis_connections_closed");
}
