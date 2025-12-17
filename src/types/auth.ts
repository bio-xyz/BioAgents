/**
 * Authentication Types for BioAgents Framework
 *
 * Supports three auth modes:
 * - none: No authentication (development/self-hosted)
 * - jwt: JWT signed with BIOAGENTS_SECRET (production)
 * - x402: Cryptographic wallet payment proof (permissionless)
 */

/**
 * Authentication methods supported by the framework
 */
export type AuthMethod = "jwt" | "x402" | "api_key" | "anonymous";

/**
 * Auth modes that can be configured via AUTH_MODE env var
 * Note: x402 is controlled separately via X402_ENABLED flag
 */
export type AuthMode = "none" | "jwt";

/**
 * Authentication context attached to requests
 * Available as `request.auth` after authResolver middleware
 */
export interface AuthContext {
  /** Internal user ID (UUID format) */
  userId: string;

  /** How the user was authenticated */
  method: AuthMethod;

  /**
   * Whether the identity is cryptographically verified
   * - true: JWT signature valid OR x402 payment verified
   * - false: Anonymous or unverified
   */
  verified: boolean;

  /** External identifier (wallet address, email, etc.) */
  externalId?: string;

  /** Email from JWT claims (optional) */
  email?: string;

  /** Organization ID for multi-tenant deployments (optional) */
  orgId?: string;

  /** Additional claims from JWT (optional) */
  claims?: Record<string, unknown>;
}

/**
 * JWT payload structure for BioAgents authentication
 * Deployers sign this with BIOAGENTS_SECRET
 */
export interface BioAgentsJWTPayload {
  /** Subject - User ID (REQUIRED, becomes userId) */
  sub: string;

  /** Expiration timestamp in seconds (REQUIRED) */
  exp: number;

  /** Issued at timestamp in seconds (REQUIRED) */
  iat: number;

  /** User email (optional) */
  email?: string;

  /** User display name (optional) */
  name?: string;

  /** Subscription plan (optional, e.g., "free", "pro", "enterprise") */
  plan?: string;

  /** Organization ID for multi-tenant (optional) */
  orgId?: string;

  /** JWT ID for tracking/revocation (optional) */
  jti?: string;

  /** Issuer - who generated the token (optional) */
  iss?: string;

  /** Audience - intended recipient (optional) */
  aud?: string | string[];
}

/**
 * Result of JWT verification
 */
export interface JWTVerificationResult {
  /** Whether the JWT is valid */
  valid: boolean;

  /** Decoded payload if valid */
  payload?: BioAgentsJWTPayload;

  /** Error reason if invalid */
  error?: string;
}

/**
 * Options for the authResolver middleware
 */
export interface AuthResolverOptions {
  /**
   * Whether authentication is required
   * - true: Returns 401 if no valid auth
   * - false: Allows anonymous access with generated userId
   * @default true
   */
  required?: boolean;
}

/**
 * Auth configuration derived from environment variables
 */
export interface AuthConfig {
  /** Current auth mode */
  mode: AuthMode;

  /** Whether a secret is configured */
  hasSecret: boolean;

  /** Whether x402 is enabled (can work alongside JWT) */
  x402Enabled: boolean;

  /** Maximum JWT expiration allowed (in seconds) */
  maxJwtExpiration: number;
}

/**
 * Get auth configuration from environment
 */
export function getAuthConfig(): AuthConfig {
  const mode = (process.env.AUTH_MODE as AuthMode) || "none";
  const hasSecret = !!process.env.BIOAGENTS_SECRET;
  const x402Enabled = process.env.X402_ENABLED === "true";
  const maxJwtExpiration = parseInt(process.env.MAX_JWT_EXPIRATION || "3600", 10); // 1h default

  return {
    mode,
    hasSecret,
    x402Enabled,
    maxJwtExpiration,
  };
}
