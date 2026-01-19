/**
 * Rate Limiter Middleware for BioAgents API
 *
 * Implements per-user rate limiting using Redis sliding window.
 * Only active when USE_JOB_QUEUE=true (requires Redis).
 *
 * Rate limits:
 * - Chat: 10 requests per minute per user
 * - Deep Research: 3 requests per 5 minutes per user
 */

import type { AuthContext } from "../types/auth";
import { isJobQueueEnabled } from "../services/queue/connection";
import logger from "../utils/logger";

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  max: number; // Max requests
  window: number; // Time window in seconds
}

/**
 * Default rate limits (can be overridden via env vars)
 */
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  chat: {
    max: parseInt(process.env.CHAT_RATE_LIMIT_PER_MINUTE || "10"),
    window: 60, // 1 minute
  },
  "deep-research": {
    max: parseInt(process.env.DEEP_RESEARCH_RATE_LIMIT_PER_5MIN || "3"),
    window: 300, // 5 minutes
  },
};

/**
 * Result of rate limit check
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
}

/**
 * Check rate limit for a user and action
 *
 * Uses Redis sorted set for sliding window implementation.
 * Each request is stored with timestamp as score.
 *
 * @param userId - User ID to check
 * @param action - Action type ("chat" or "deep-research")
 * @returns Rate limit result
 */
export async function checkRateLimit(
  userId: string,
  action: "chat" | "deep-research",
): Promise<RateLimitResult> {
  // If job queue is not enabled, skip rate limiting
  if (!isJobQueueEnabled()) {
    return {
      allowed: true,
      remaining: 999,
      resetIn: 0,
    };
  }

  const config = RATE_LIMITS[action];
  if (!config) {
    logger.warn({ action }, "unknown_rate_limit_action");
    return { allowed: true, remaining: 999, resetIn: 0 };
  }

  // Get Redis connection
  const { getBullMQConnection } = await import("../services/queue/connection");
  const redis = getBullMQConnection();

  const key = `ratelimit:${action}:${userId}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.window;

  try {
    // Use Redis transaction for atomic operations
    const multi = redis.multi();

    // Remove old entries outside window
    multi.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    multi.zcard(key);

    // Add current request (will be committed only if allowed)
    multi.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);

    // Set expiry on key
    multi.expire(key, config.window);

    const results = await multi.exec();

    // Get count from second command (index 1)
    const currentCount = (results?.[1]?.[1] as number) || 0;

    if (currentCount >= config.max) {
      // Rate limit exceeded - remove the entry we just added
      await redis.zremrangebyscore(key, now, now);

      // Get oldest entry to calculate reset time
      const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
      const resetIn =
        oldest.length > 1
          ? config.window - (now - parseInt(oldest[1] || "0"))
          : config.window;

      logger.warn(
        {
          userId,
          action,
          currentCount,
          max: config.max,
          resetIn,
        },
        "rate_limit_exceeded",
      );

      return {
        allowed: false,
        remaining: 0,
        resetIn: Math.max(1, resetIn),
      };
    }

    logger.info(
      {
        userId,
        action,
        currentCount: currentCount + 1,
        max: config.max,
        remaining: config.max - currentCount - 1,
      },
      "rate_limit_checked",
    );

    return {
      allowed: true,
      remaining: config.max - currentCount - 1,
      resetIn: config.window,
    };
  } catch (error) {
    // On Redis error, allow request but log warning
    logger.error({ error, userId, action }, "rate_limit_check_failed");
    return {
      allowed: true,
      remaining: 999,
      resetIn: 0,
    };
  }
}

/**
 * Rate limit middleware factory for Elysia routes
 *
 * Creates a beforeHandle function that checks rate limits.
 * Must be used after authResolver middleware (requires request.auth).
 *
 * @param action - Action type ("chat" or "deep-research")
 * @returns Elysia beforeHandle function
 *
 * @example
 * ```typescript
 * app.guard(
 *   {
 *     beforeHandle: [
 *       authResolver({ required: true }),
 *       rateLimitMiddleware("chat"),
 *     ],
 *   },
 *   (app) => app.post("/api/chat", chatHandler)
 * );
 * ```
 */
export function rateLimitMiddleware(action: "chat" | "deep-research") {
  return async ({
    request,
    set,
  }: {
    request: Request & { auth?: AuthContext };
    set: any;
  }) => {
    // Skip if job queue not enabled
    if (!isJobQueueEnabled()) {
      return;
    }

    // Get user ID from auth context - auth is required, no anonymous fallback
    const auth = (request as any).auth as AuthContext | undefined;
    
    if (!auth?.userId) {
      // Should not happen if authResolver runs before this middleware
      logger.warn({ action }, "rate_limit_no_auth_context");
      set.status = 401;
      return {
        error: "Authentication required",
        message: "You must be authenticated to access this endpoint",
      };
    }

    const userId = auth.userId;
    const result = await checkRateLimit(userId, action);

    // Set rate limit headers
    set.headers["X-RateLimit-Limit"] = String(RATE_LIMITS[action]?.max || 0);
    set.headers["X-RateLimit-Remaining"] = String(result.remaining);
    set.headers["X-RateLimit-Reset"] = String(result.resetIn);

    if (!result.allowed) {
      set.status = 429;
      return {
        error: "Rate limit exceeded",
        message: `Too many requests. Try again in ${result.resetIn} seconds.`,
        retryAfter: result.resetIn,
      };
    }
  };
}
