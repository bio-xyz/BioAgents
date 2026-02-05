/**
 * Privy Authentication Bypass Middleware
 *
 * Allows Privy-authenticated users to bypass x402 payments.
 * Works in conjunction with x402 middleware - runs BEFORE x402 to set bypass flag.
 *
 * Flow:
 * 1. Check if user is authenticated (JWT/Privy)
 * 2. If authenticated: set bypassX402=true
 * 3. If not authenticated: let x402 middleware handle payment
 */

import { Elysia } from "elysia";
import { getServiceClient } from "../db/client";
import logger from "../utils/logger";
import type { AuthContext } from "../types/auth";

export interface PrivyAuthBypassOptions {
  /** Skip bypass for these auth methods (default: ["x402", "anonymous"]) */
  skipForMethods?: string[];
}

/**
 * Look up the Privy ID for a user from their internal database ID
 * The users table has `id` (internal UUID) and `user_id` (Privy ID)
 */
async function getPrivyId(userId: string): Promise<string | null> {
  try {
    const supabase = getServiceClient();

    // First try: userId might already be the Privy ID (stored in user_id column)
    const { data: byPrivyId } = await supabase
      .from("users")
      .select("user_id, id")
      .eq("user_id", userId)
      .single();

    if (byPrivyId?.user_id) {
      return byPrivyId.user_id;
    }

    // Second try: userId is the internal UUID
    const { data: byInternalId } = await supabase
      .from("users")
      .select("user_id")
      .eq("id", userId)
      .single();

    return byInternalId?.user_id || null;
  } catch (err) {
    logger?.error({ err, userId }, "privy_auth_lookup_failed");
    return null;
  }
}

/**
 * Privy authentication bypass middleware
 *
 * Must be applied AFTER authResolver and BEFORE x402Middleware
 *
 * @example
 * ```typescript
 * app.guard({
 *   beforeHandle: [authResolver({ required: false })]
 * }, (app) => 
 *   app
 *     .use(privyAuthBypass())
 *     .use(x402Middleware())
 *     .post("/api/chat", handler)
 * );
 * ```
 */
export function privyAuthBypass(options: PrivyAuthBypassOptions = {}) {
  const { skipForMethods = ["x402", "anonymous"] } = options;

  const plugin = new Elysia({ name: "privy-auth-bypass" });

  plugin.onBeforeHandle(
    { as: "scoped" },
    async ({ request, path }: { request: Request & { auth?: AuthContext }; path: string }) => {
      const auth = (request as any).auth as AuthContext | undefined;

      // Skip if no auth context (authResolver hasn't run)
      if (!auth) {
        logger?.debug({ path }, "privy_bypass_skipped_no_auth");
        return;
      }

      // Skip for certain auth methods (let x402 handle these)
      if (skipForMethods.includes(auth.method)) {
        logger?.debug(
          { path, method: auth.method },
          "privy_bypass_skipped_method"
        );
        return;
      }

      // Look up Privy ID to confirm this is a Privy-authenticated user
      const privyId = await getPrivyId(auth.userId);
      if (!privyId) {
        logger?.debug(
          { path, userId: auth.userId },
          "privy_bypass_no_privy_id"
        );
        return; // Let x402 handle payment
      }

      // User is Privy-authenticated - set bypass flags
      (request as any).bypassX402 = true;
      (request as any).authenticatedUser = {
        userId: auth.userId,
        privyId,
        authMethod: auth.method,
      };

      // Set synthetic x402Settlement so handlers work without modification
      (request as any).x402Settlement = {
        success: true,
        transaction: `privy:${privyId}:${Date.now()}`,
        network: "privy",
        payer: auth.userId,
        paymentMethod: "privy",
      };

      logger?.info(
        {
          path,
          userId: auth.userId,
          privyId,
          authMethod: auth.method,
        },
        "privy_auth_bypass_x402_set"
      );
    }
  );

  return plugin;
}

// Export with old name for backward compatibility
export const creditAuthMiddleware = privyAuthBypass;

export default privyAuthBypass;
