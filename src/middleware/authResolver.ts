/**
 * Unified Authentication Resolver Middleware for BioAgents Framework
 *
 * AUTH_MODE env var controls JWT authentication:
 * - none: No auth required (development only)
 * - jwt: JWT signed with BIOAGENTS_SECRET required (production)
 *
 * X402_ENABLED env var controls payment auth (independent of AUTH_MODE):
 * - true: x402 payment routes available
 * - false: x402 disabled
 *
 * Priority order when multiple auth methods present:
 * 1. x402 payment proof (cryptographic, highest trust)
 * 2. JWT token (verified signature)
 * 3. API key fallback (for backward compatibility)
 * 4. Anonymous (if mode=none or auth not required)
 */

import type {
  AuthContext,
  AuthMode,
  AuthResolverOptions,
} from "../types/auth";
import { getAuthConfig } from "../types/auth";
import { verifyJWT, extractBearerToken } from "../services/jwt";
import { generateUUID } from "../utils/uuid";
import { walletAddressToUUID } from "../utils/uuid";
import logger from "../utils/logger";

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

/**
 * Check if request has valid API key (legacy support)
 */
function isValidApiKey(request: Request): boolean {
  const secret = process.env.BIOAGENTS_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");

  // Check X-API-Key header first (explicit API key)
  if (apiKeyHeader) {
    return constantTimeCompare(apiKeyHeader, secret);
  }

  // Check Authorization header - but only if it's the raw secret, not a JWT
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // If it looks like a JWT (has dots), don't treat as API key
    if (token.includes(".")) {
      return false;
    }
    return constantTimeCompare(token, secret);
  }

  return false;
}

/**
 * Create the auth resolver middleware
 *
 * @param options - Configuration options
 * @returns Elysia beforeHandle function
 *
 * @example
 * ```typescript
 * // In route definition
 * app.guard(
 *   { beforeHandle: [authResolver({ required: true })] },
 *   (app) => app.post("/api/chat", handler)
 * );
 *
 * // In handler, access authenticated user
 * function handler({ request }) {
 *   const userId = request.auth.userId;
 *   const method = request.auth.method;
 * }
 * ```
 */
export function authResolver(options: AuthResolverOptions = {}) {
  const { required = true } = options;
  const config = getAuthConfig();

  return async ({
    request,
    set,
    body,
  }: {
    request: Request & { auth?: AuthContext; x402Settlement?: any };
    set: any;
    body?: any;
  }) => {
    let auth: AuthContext | null = null;
    const path = new URL(request.url).pathname;

    logger?.info(
      {
        path,
        mode: config.mode,
        required,
        hasX402Settlement: !!(request as any).x402Settlement,
      },
      "auth_resolver_start"
    );

    // =====================================================
    // Priority 1: x402 Payment Proof (Cryptographic)
    // =====================================================
    // x402 middleware runs before this and sets x402Settlement on request
    // This is the most secure - wallet signature = identity
    const x402Settlement = (request as any).x402Settlement;
    if (x402Settlement?.payer) {
      const userId = walletAddressToUUID(x402Settlement.payer);
      auth = {
        userId,
        method: "x402",
        verified: true,
        externalId: x402Settlement.payer,
      };

      logger?.info(
        {
          userId,
          wallet: x402Settlement.payer,
          method: "x402",
        },
        "auth_resolved_x402"
      );
    }

    // =====================================================
    // Priority 2: JWT Token (Signed with BIOAGENTS_SECRET)
    // =====================================================
    // Check JWT when:
    // - AUTH_MODE=jwt (primary JWT mode)
    // - Or when a JWT-like token is provided (allows JWT+x402 hybrid)
    if (!auth) {
      const authHeader = request.headers.get("Authorization");
      const token = extractBearerToken(authHeader);

      // Only verify if it looks like a JWT (has dots) or if we're in JWT mode
      const shouldVerifyJwt = token && (config.mode === "jwt" || token.includes("."));

      if (shouldVerifyJwt && token) {
        const result = await verifyJWT(token);

        if (result.valid && result.payload) {
          auth = {
            userId: result.payload.sub,
            method: "jwt",
            verified: true,
            email: result.payload.email,
            orgId: result.payload.orgId,
            claims: result.payload as unknown as Record<string, unknown>,
          };

          logger?.info(
            {
              userId: auth.userId,
              method: "jwt",
              hasEmail: !!auth.email,
              hasOrgId: !!auth.orgId,
            },
            "auth_resolved_jwt"
          );
        } else if (config.mode === "jwt") {
          // JWT provided but invalid - only reject in strict JWT mode
          logger?.warn(
            {
              error: result.error,
              path,
            },
            "auth_jwt_invalid"
          );

          // In JWT mode, invalid JWT = reject (don't fall through)
          if (required) {
            set.status = 401;
            return {
              error: "Invalid authentication",
              message: result.error || "JWT verification failed",
              hint: "Provide a valid JWT signed with BIOAGENTS_SECRET",
            };
          }
        }
        // In non-JWT mode with invalid JWT, just continue to next auth method
      }
    }

    // =====================================================
    // Priority 3: API Key (Legacy/Backward Compatibility)
    // =====================================================
    // Only used if JWT mode is not active or no JWT provided
    if (!auth && isValidApiKey(request)) {
      // API key is valid - trust the caller's userId from body
      const providedUserId = body?.userId;
      const userId =
        providedUserId &&
        typeof providedUserId === "string" &&
        providedUserId.length > 0
          ? providedUserId
          : generateUUID();

      auth = {
        userId,
        method: "api_key",
        verified: false, // Caller-provided userId, not cryptographic
      };

      logger?.info(
        {
          userId,
          method: "api_key",
          userIdSource: providedUserId ? "body" : "generated",
        },
        "auth_resolved_api_key"
      );
    }

    // =====================================================
    // Priority 4: None Mode (Development)
    // =====================================================
    if (!auth && config.mode === "none") {
      const providedUserId = body?.userId;
      const userId =
        providedUserId &&
        typeof providedUserId === "string" &&
        providedUserId.length > 0
          ? providedUserId
          : generateUUID();

      auth = {
        userId,
        method: "anonymous",
        verified: false,
      };

      logger?.info(
        {
          userId,
          method: "anonymous",
          userIdSource: providedUserId ? "body" : "generated",
        },
        "auth_resolved_anonymous"
      );
    }

    // =====================================================
    // No Auth - Check if Required
    // =====================================================
    if (!auth) {
      if (required) {
        logger?.warn(
          {
            path,
            mode: config.mode,
          },
          "auth_required_but_missing"
        );

        set.status = 401;

        // Provide helpful error based on mode
        if (config.mode === "jwt") {
          return {
            error: "Authentication required",
            message: "Valid JWT required",
            hint: "Include 'Authorization: Bearer <jwt>' header with a JWT signed using BIOAGENTS_SECRET",
          };
        } else {
          return {
            error: "Authentication required",
            hint: "Configure AUTH_MODE or provide valid credentials",
          };
        }
      }

      // Not required - create anonymous auth
      auth = {
        userId: generateUUID(),
        method: "anonymous",
        verified: false,
      };

      logger?.info(
        {
          userId: auth.userId,
          method: "anonymous",
        },
        "auth_resolved_anonymous_fallback"
      );
    }

    // Attach auth context to request
    (request as any).auth = auth;

    logger?.info(
      {
        userId: auth.userId,
        method: auth.method,
        verified: auth.verified,
        path,
      },
      "auth_resolver_complete"
    );
  };
}

/**
 * Legacy compatibility: authBeforeHandle
 *
 * This wraps authResolver for backward compatibility with existing code
 * that uses authBeforeHandle({ optional: true/false })
 *
 * @deprecated Use authResolver() instead
 */
export function authBeforeHandle(options: { optional?: boolean } = {}) {
  return authResolver({ required: !options.optional });
}

/**
 * Standalone auth resolution function
 * Can be called directly without Elysia middleware context
 *
 * @param request - The incoming request
 * @param body - Optional parsed request body (for userId extraction in dev mode)
 * @returns AuthContext with userId if authenticated
 */
export async function resolveAuth(request: Request, body?: any): Promise<{
  authenticated: boolean;
  userId?: string;
  method?: string;
}> {
  const config = getAuthConfig();

  // Check x402 settlement (set by x402 middleware on request)
  const x402Settlement = (request as any).x402Settlement;
  if (x402Settlement?.payer) {
    return {
      authenticated: true,
      userId: walletAddressToUUID(x402Settlement.payer),
      method: "x402",
    };
  }

  // Check JWT
  const authHeader = request.headers.get("Authorization");
  const token = extractBearerToken(authHeader);

  if (token) {
    const result = await verifyJWT(token);
    if (result.valid && result.payload?.sub) {
      return {
        authenticated: true,
        userId: result.payload.sub,
        method: "jwt",
      };
    }
  }

  // Helper to get userId from body (same logic as authResolver middleware)
  const getUserIdFromBody = () => {
    const providedUserId = body?.userId;
    return providedUserId &&
      typeof providedUserId === "string" &&
      providedUserId.length > 0
      ? providedUserId
      : generateUUID();
  };

  // Check API key (legacy)
  if (isValidApiKey(request)) {
    return {
      authenticated: true,
      userId: getUserIdFromBody(),
      method: "api_key",
    };
  }

  // Check if auth is required
  if (config.mode === "none") {
    return {
      authenticated: true,
      userId: getUserIdFromBody(),
      method: "anonymous",
    };
  }

  return {
    authenticated: false,
  };
}

export default authResolver;
