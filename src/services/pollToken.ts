/**
 * Poll Token Service for x402 Deep Research Status Endpoint
 *
 * Generates and verifies signed JWTs ("poll tokens") that authorize
 * status polling for specific deep research messages.
 *
 * Poll tokens are self-validating — no database storage needed.
 * They use the existing BIOAGENTS_SECRET and jose library.
 *
 * Token spec:
 * - Algorithm: HS256
 * - Claims: sub=messageId, purpose="poll"
 * - Default TTL: 24 hours (configurable via POLL_TOKEN_TTL_SECONDS)
 */

import * as jose from "jose";
import logger from "../utils/logger";

export interface PollTokenVerificationResult {
  valid: boolean;
  messageId?: string;
  error?: string;
}

/** Default TTL: 24 hours */
const DEFAULT_POLL_TOKEN_TTL_SECONDS = 86400;

function getSecretKey(): Uint8Array | null {
  const secret = process.env.BIOAGENTS_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function getPollTokenTTL(): number {
  const envTTL = process.env.POLL_TOKEN_TTL_SECONDS;
  if (envTTL) {
    const parsed = parseInt(envTTL, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_POLL_TOKEN_TTL_SECONDS;
}

/**
 * Generate a signed poll token for a specific messageId.
 *
 * @param messageId - The message ID this token authorizes polling for
 * @returns Signed JWT string, or null if BIOAGENTS_SECRET is not configured
 */
export async function generatePollToken(
  messageId: string,
): Promise<string | null> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    logger?.warn("poll_token_generation_no_secret_configured");
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = getPollTokenTTL();

  const token = await new jose.SignJWT({
    purpose: "poll",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(messageId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secretKey);

  logger?.info({ messageId, ttl, exp: now + ttl }, "poll_token_generated");

  return token;
}

/**
 * Verify a poll token and extract the messageId.
 *
 * Checks:
 * 1. Valid HS256 signature with BIOAGENTS_SECRET
 * 2. Not expired
 * 3. Has purpose="poll" claim (rejects regular user JWTs)
 * 4. Has sub claim (messageId)
 *
 * @param token - The poll token string
 * @returns Verification result with messageId if valid
 */
export async function verifyPollToken(
  token: string,
): Promise<PollTokenVerificationResult> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    return { valid: false, error: "BIOAGENTS_SECRET not configured" };
  }

  try {
    const { payload } = await jose.jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    // Validate purpose claim — rejects regular user JWTs
    if (payload.purpose !== "poll") {
      logger?.warn({ purpose: payload.purpose }, "poll_token_wrong_purpose");
      return { valid: false, error: "Token is not a poll token" };
    }

    // Validate sub claim (messageId)
    if (!payload.sub) {
      logger?.warn("poll_token_missing_sub");
      return { valid: false, error: "Token missing messageId" };
    }

    return { valid: true, messageId: payload.sub };
  } catch (err: any) {
    if (err instanceof jose.errors.JWTExpired) {
      logger?.info("poll_token_expired");
      return { valid: false, error: "Poll token has expired" };
    }
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger?.warn("poll_token_invalid_signature");
      return { valid: false, error: "Invalid poll token signature" };
    }
    logger?.warn({ error: err.message }, "poll_token_verification_failed");
    return {
      valid: false,
      error: err.message || "Poll token verification failed",
    };
  }
}
