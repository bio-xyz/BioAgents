import { Elysia } from "elysia";
import { verifyMessage } from "viem";
import * as jose from "jose";
import logger from "../utils/logger";

/**
 * Smart Authentication Middleware
 *
 * Supports multiple authentication methods:
 * 1. Privy JWT tokens (Next.js frontend) - Bypasses x402
 * 2. CDP wallet signatures (Dev UI) - Still requires x402
 * 3. No authentication (AI agents) - Requires x402
 */

export interface SmartAuthOptions {
  /** Privy App ID from dashboard */
  privyAppId?: string;
  /** Privy verification key (public key) */
  privyVerificationKey?: string;
  /** Allow CDP wallet signatures (for dev UI) */
  allowCdpSignatures?: boolean;
  /** Allow unauthenticated requests (for AI agents) */
  optional?: boolean;
  /** Signature time-to-live in milliseconds */
  signatureTTL?: number;
}

export interface AuthenticatedUser {
  userId: string;
  authMethod: "privy" | "cdp";
  walletAddress?: string;
  email?: string;
}

/**
 * Creates a smart authentication middleware instance
 */
export function smartAuthMiddleware(options: SmartAuthOptions = {}) {
  const {
    privyAppId = process.env.PRIVY_APP_ID,
    privyVerificationKey = process.env.PRIVY_VERIFICATION_KEY,
    allowCdpSignatures = true,
    optional = true, // Default: allow unauthenticated for AI agents
    signatureTTL = parseInt(process.env.AUTH_SIGNATURE_TTL || "300000"), // 5 min
  } = options;

  return new Elysia({ name: "smart-auth" }).onBeforeHandle(
    async ({ request, body, set }) => {
      const authHeader = request.headers.get("Authorization");
      const parsedBody = body as any;

      // Priority 1: Check for Privy JWT (Next.js frontend)
      if (authHeader?.startsWith("Bearer ")) {
        const result = await verifyPrivyToken(authHeader, request, set, {
          privyAppId,
          privyVerificationKey,
        });

        if (result === true) {
          // Privy auth successful - mark for x402 bypass
          (request as any).bypassX402 = true;
          return;
        }

        // Invalid Privy token - fail immediately
        if (result !== null) return result;
      }

      // Priority 2: Check for CDP signature (Dev UI)
      if (allowCdpSignatures && parsedBody?.authSignature) {
        const result = await verifyCdpSignature(
          parsedBody,
          request,
          set,
          signatureTTL,
        );

        if (result === true) {
          // CDP auth successful - will still require x402
          return;
        }

        if (result !== null) return result;
      }

      // Priority 3: No authentication (AI Agents)
      if (optional) {
        if (logger) {
          logger.info("request_without_authentication_requires_x402");
        }
        return;
      }

      // If optional=false and no auth provided, reject
      set.status = 401;
      return {
        error: "Authentication required",
        methods: {
          privy: "Send JWT in Authorization: Bearer <token> header",
          cdp: "Include authSignature, authTimestamp, and userId in body",
        },
      };
    },
  );
}

/**
 * Verify Privy JWT token
 * @returns true on success, error object on failure, null if not applicable
 */
async function verifyPrivyToken(
  authHeader: string,
  request: any,
  set: any,
  config: {
    privyAppId?: string;
    privyVerificationKey?: string;
  },
): Promise<true | object | null> {
  const token = authHeader.substring(7); // Remove "Bearer "

  if (!config.privyVerificationKey) {
    // Privy not configured - skip this auth method
    if (logger) {
      logger.warn(
        "privy_jwt_provided_but_verification_key_not_configured",
      );
    }
    return null;
  }

  try {
    // Import the verification key
    const verificationKey = await jose.importSPKI(
      config.privyVerificationKey,
      "ES256",
    );

    // Verify the JWT
    const { payload } = await jose.jwtVerify(token, verificationKey, {
      issuer: "privy.io",
      audience: config.privyAppId,
    });

    // Attach authenticated user info to request
    const authenticatedUser: AuthenticatedUser = {
      userId: payload.sub!, // Privy DID (e.g., "did:privy:abc123")
      authMethod: "privy",
      walletAddress: (payload as any).wallet_address,
      email: (payload as any).email,
    };

    (request as any).authenticatedUser = authenticatedUser;

    if (logger) {
      logger.info(
        { userId: authenticatedUser.userId },
        "privy_auth_success_x402_will_be_bypassed",
      );
    }

    return true;
  } catch (err: any) {
    if (logger) {
      logger.warn({ err: err.message }, "privy_jwt_verification_failed");
    }

    set.status = 401;
    return {
      error: "Invalid or expired Privy token",
      details: err.message,
    };
  }
}

/**
 * Verify CDP wallet signature
 * @returns true on success, error object on failure, null if not applicable
 */
async function verifyCdpSignature(
  body: any,
  request: any,
  set: any,
  signatureTTL: number,
): Promise<true | object | null> {
  const { userId, authTimestamp, authSignature } = body;

  // Check if all required fields are present
  if (!userId || !authTimestamp || !authSignature) {
    // Missing fields - not using CDP auth
    return null;
  }

  // Validate timestamp format
  const timestamp = parseInt(authTimestamp);
  if (isNaN(timestamp)) {
    set.status = 401;
    return {
      error: "Invalid timestamp format",
      hint: "authTimestamp must be a valid Unix timestamp in milliseconds",
    };
  }

  // Check timestamp expiration (prevent replay attacks)
  const now = Date.now();
  const age = now - timestamp;

  if (age > signatureTTL) {
    set.status = 401;
    return {
      error: "CDP signature expired",
      age: `${(age / 1000).toFixed(1)}s`,
      maxAge: `${signatureTTL / 1000}s`,
    };
  }

  if (age < -60000) {
    // Timestamp more than 1 minute in the future
    set.status = 401;
    return {
      error: "CDP signature timestamp is in the future",
      hint: "Check client clock synchronization",
    };
  }

  // Construct the message that was signed
  const message = `BioAgents Auth\nTimestamp: ${timestamp}\nUser: ${userId}`;

  try {
    // Verify the signature
    const isValid = await verifyMessage({
      address: userId as `0x${string}`,
      message,
      signature: authSignature as `0x${string}`,
    });

    if (!isValid) {
      set.status = 401;
      return {
        error: "Invalid CDP wallet signature",
        hint: "Signature does not match the provided userId",
      };
    }

    // Attach authenticated user info to request
    const authenticatedUser: AuthenticatedUser = {
      userId, // Wallet address
      authMethod: "cdp",
      walletAddress: userId,
    };

    (request as any).authenticatedUser = authenticatedUser;

    if (logger) {
      logger.info(
        { userId },
        "cdp_auth_success_x402_still_required",
      );
    }

    return true;
  } catch (err: any) {
    if (logger) {
      logger.error(
        { err: err.message, userId },
        "cdp_signature_verification_failed",
      );
    }

    set.status = 401;
    return {
      error: "CDP signature verification failed",
      details: err.message,
    };
  }
}
