/**
 * JWT Verification Service for BioAgents Framework
 *
 * Verifies JWTs signed with BIOAGENTS_SECRET using HS256 algorithm.
 * Deployers generate JWTs in their backend and send them to BioAgents.
 */

import * as jose from "jose";
import type {
  BioAgentsJWTPayload,
  JWTVerificationResult,
} from "../types/auth";
import logger from "../utils/logger";

// Cache the secret key encoder to avoid re-encoding on every request
let cachedSecretKey: Uint8Array | null = null;

/**
 * Get the secret key for JWT verification
 * Caches the encoded key for performance
 */
function getSecretKey(): Uint8Array | null {
  if (cachedSecretKey) {
    return cachedSecretKey;
  }

  const secret = process.env.BIOAGENTS_SECRET;
  if (!secret) {
    return null;
  }

  cachedSecretKey = new TextEncoder().encode(secret);
  return cachedSecretKey;
}

/**
 * Clear the cached secret key (useful for testing or key rotation)
 */
export function clearSecretKeyCache(): void {
  cachedSecretKey = null;
}

/**
 * Verify a JWT token signed with BIOAGENTS_SECRET
 *
 * @param token - The JWT token string (without "Bearer " prefix)
 * @returns Verification result with payload if valid
 *
 * @example
 * ```typescript
 * const result = await verifyJWT(token);
 * if (result.valid) {
 *   console.log('User ID:', result.payload.sub);
 * } else {
 *   console.error('Invalid token:', result.error);
 * }
 * ```
 */
export async function verifyJWT(token: string): Promise<JWTVerificationResult> {
  const secretKey = getSecretKey();

  if (!secretKey) {
    logger?.warn("jwt_verification_no_secret_configured");
    return {
      valid: false,
      error: "BIOAGENTS_SECRET not configured",
    };
  }

  try {
    // Verify the JWT signature and decode payload
    const { payload } = await jose.jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    // Validate required claims
    if (!payload.sub) {
      logger?.warn("jwt_missing_sub_claim");
      return {
        valid: false,
        error: "JWT missing required 'sub' claim (user ID)",
      };
    }

    // Check expiration is not too far in the future (optional security measure)
    const maxExpiration = parseInt(
      process.env.MAX_JWT_EXPIRATION || "86400",
      10
    ); // 24h default
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp - now > maxExpiration) {
      logger?.warn(
        { exp: payload.exp, maxAllowed: now + maxExpiration },
        "jwt_expiration_too_far"
      );
      return {
        valid: false,
        error: `JWT expiration too far in future (max ${maxExpiration}s)`,
      };
    }

    // Cast to our payload type
    const bioAgentsPayload: BioAgentsJWTPayload = {
      sub: payload.sub as string,
      exp: payload.exp as number,
      iat: payload.iat as number,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      plan: payload.plan as string | undefined,
      orgId: payload.orgId as string | undefined,
      jti: payload.jti as string | undefined,
      iss: payload.iss as string | undefined,
      aud: payload.aud as string | string[] | undefined,
    };

    logger?.info(
      {
        sub: bioAgentsPayload.sub,
        exp: bioAgentsPayload.exp,
        hasEmail: !!bioAgentsPayload.email,
        hasOrgId: !!bioAgentsPayload.orgId,
      },
      "jwt_verification_success"
    );

    return {
      valid: true,
      payload: bioAgentsPayload,
    };
  } catch (err: any) {
    // Handle specific jose errors
    if (err instanceof jose.errors.JWTExpired) {
      logger?.warn("jwt_expired");
      return {
        valid: false,
        error: "JWT has expired",
      };
    }

    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger?.warn("jwt_invalid_signature");
      return {
        valid: false,
        error: "Invalid JWT signature",
      };
    }

    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      logger?.warn({ claim: err.claim }, "jwt_claim_validation_failed");
      return {
        valid: false,
        error: `JWT claim validation failed: ${err.claim}`,
      };
    }

    // Generic error
    logger?.warn({ error: err.message }, "jwt_verification_failed");
    return {
      valid: false,
      error: err.message || "JWT verification failed",
    };
  }
}

/**
 * Extract bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The token string or null if not found/invalid
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  // Support both "Bearer <token>" and raw "<token>"
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // If it looks like a JWT (has two dots), accept it directly
  if (authHeader.split(".").length === 3) {
    return authHeader;
  }

  return null;
}

/**
 * Generate a JWT for testing purposes
 * NOTE: This should only be used in tests, not in production
 *
 * @param payload - The JWT payload
 * @param expiresIn - Expiration in seconds (default: 1 hour)
 * @returns Signed JWT string
 */
export async function generateTestJWT(
  payload: Partial<BioAgentsJWTPayload>,
  expiresIn: number = 3600
): Promise<string> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error("BIOAGENTS_SECRET not configured");
  }

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({
    ...payload,
    sub: payload.sub || "test-user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .sign(secretKey);

  return jwt;
}
