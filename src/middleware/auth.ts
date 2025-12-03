import logger from "../utils/logger";

/**
 * Simple Secret Authentication Middleware (Hasura-style)
 *
 * Validates requests against BIOAGENTS_SECRET environment variable.
 * Accepts secret via:
 * - Authorization: Bearer <secret>
 * - X-API-Key: <secret>
 */

export interface AuthOptions {
  /** Allow requests without authentication (for development) */
  optional?: boolean;
}

/**
 * Authentication beforeHandle function for use with Elysia's guard
 * Export this to use with .guard({ beforeHandle: [authBeforeHandle(options)] }, app => ...)
 */
export function authBeforeHandle(options: AuthOptions = {}) {
  const { optional = false } = options;
  
  return async ({ request, set }: { request: Request; set: any }) => {
    const BIOAGENTS_SECRET = process.env.BIOAGENTS_SECRET;

    logger.info({
      path: new URL(request.url).pathname,
      optional,
      hasSecret: !!BIOAGENTS_SECRET,
    }, "auth_check");

    // If no secret configured
    if (!BIOAGENTS_SECRET) {
      if (optional) {
        logger.info("auth_skipped_no_secret_configured");
        return; // Allow through
      }
      set.status = 500;
      return {
        error: "Server misconfiguration",
        message: "BIOAGENTS_SECRET not configured",
      };
    }

    // Extract secret from request
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader = request.headers.get("X-API-Key");

    let providedSecret: string | null = null;

    // Priority 1: Authorization Bearer header
    if (authHeader?.startsWith("Bearer ")) {
      providedSecret = authHeader.substring(7); // Remove "Bearer "
    }
    // Priority 2: X-API-Key header
    else if (apiKeyHeader) {
      providedSecret = apiKeyHeader;
    }

    // No secret provided
    if (!providedSecret) {
      if (optional) {
        logger.info("auth_skipped_optional_mode");
        return; // Allow through
      }

      logger.warn("auth_no_secret_provided");
      set.status = 401;
      return {
        error: "Authentication required",
        hint: "Provide secret via 'Authorization: Bearer <secret>' or 'X-API-Key: <secret>' header",
      };
    }

    // Validate secret (constant-time comparison to prevent timing attacks)
    const isValid = constantTimeCompare(providedSecret, BIOAGENTS_SECRET);

    if (!isValid) {
      logger.warn("auth_invalid_secret_provided");
      set.status = 401;
      return {
        error: "Invalid authentication",
        message: "The provided secret is incorrect",
      };
    }

    // Authentication successful
    logger.info("auth_success");
  };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
