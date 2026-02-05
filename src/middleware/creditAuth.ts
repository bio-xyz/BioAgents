/**
 * Credit-based Authentication Middleware
 *
 * Allows Privy-authenticated users with sufficient credits to bypass x402 payments.
 * Works in conjunction with x402 middleware - runs BEFORE x402 to set bypass flag.
 *
 * Flow:
 * 1. Check if user is authenticated (JWT/Privy)
 * 2. Look up user's credit balance
 * 3. If credits available: set bypassX402=true, reserve/deduct credit
 * 4. If no credits: let x402 middleware handle payment
 */

import { Elysia } from "elysia";
import { getServiceClient } from "../db/client";
import logger from "../utils/logger";
import type { AuthContext } from "../types/auth";

export interface CreditAuthOptions {
  /** Cost in credits per request (default: 1) */
  creditCost?: number;
  /** Whether to deduct immediately or reserve (default: true = immediate) */
  immediateDeduct?: boolean;
  /** Skip credit check for these auth methods */
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
    logger?.error({ err, userId }, "credit_auth_privy_lookup_failed");
    return null;
  }
}

/**
 * Check user's credit balance
 * Uses the 'points' field in users table as credit balance
 */
async function getUserCredits(privyId: string): Promise<number> {
  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("users")
      .select("points")
      .eq("user_id", privyId)
      .single();

    if (error) {
      logger?.error({ error, privyId }, "credit_auth_balance_check_failed");
      return 0;
    }

    return data?.points || 0;
  } catch (err) {
    logger?.error({ err, privyId }, "credit_auth_balance_check_error");
    return 0;
  }
}

/**
 * Deduct credits from user's balance
 * Returns true if successful, false if insufficient credits
 */
async function deductCredits(
  privyId: string,
  amount: number
): Promise<boolean> {
  try {
    const supabase = getServiceClient();

    // Use atomic decrement to prevent race conditions
    // This will fail if points would go negative (handled by constraint or RPC)
    const { data, error } = await supabase.rpc("deduct_user_credits", {
      p_user_id: privyId,
      p_amount: amount,
    });

    if (error) {
      // If RPC doesn't exist, fall back to manual update
      if (error.message?.includes("function") || error.code === "42883") {
        logger?.warn(
          { privyId },
          "credit_auth_rpc_not_found_using_fallback"
        );

        // Fallback: manual atomic update
        const { error: updateError } = await supabase
          .from("users")
          .update({
            points: supabase.rpc("greatest", { a: 0, b: "points - " + amount }),
          })
          .eq("user_id", privyId)
          .gte("points", amount); // Only update if sufficient balance

        if (updateError) {
          // Simple fallback without atomic guarantee
          const { data: user } = await supabase
            .from("users")
            .select("points")
            .eq("user_id", privyId)
            .single();

          if (!user || user.points < amount) {
            return false;
          }

          const { error: finalError } = await supabase
            .from("users")
            .update({ points: user.points - amount })
            .eq("user_id", privyId);

          if (finalError) {
            logger?.error(
              { finalError, privyId },
              "credit_auth_deduct_fallback_failed"
            );
            return false;
          }
        }

        return true;
      }

      logger?.error({ error, privyId }, "credit_auth_deduct_failed");
      return false;
    }

    return data?.success !== false;
  } catch (err) {
    logger?.error({ err, privyId }, "credit_auth_deduct_error");
    return false;
  }
}

/**
 * Credit authentication middleware
 *
 * Must be applied AFTER authResolver and BEFORE x402Middleware
 *
 * @example
 * ```typescript
 * app.guard({
 *   beforeHandle: [
 *     authResolver({ required: true }),
 *     creditAuthMiddleware({ creditCost: 1 }),
 *   ]
 * }, (app) => app.use(x402Middleware()).post("/api/chat", handler));
 * ```
 */
export function creditAuthMiddleware(options: CreditAuthOptions = {}) {
  const {
    creditCost = 1,
    immediateDeduct = true,
    skipForMethods = ["x402", "anonymous"],
  } = options;

  const plugin = new Elysia({ name: "credit-auth-middleware" });

  plugin.onBeforeHandle(
    { as: "scoped" },
    async ({ request, path }: { request: Request & { auth?: AuthContext }; path: string }) => {
      const auth = (request as any).auth as AuthContext | undefined;

      // Skip if no auth context (authResolver hasn't run)
      if (!auth) {
        logger?.debug({ path }, "credit_auth_skipped_no_auth");
        return;
      }

      // Skip for certain auth methods (let x402 handle these)
      if (skipForMethods.includes(auth.method)) {
        logger?.debug(
          { path, method: auth.method },
          "credit_auth_skipped_method"
        );
        return;
      }

      // Look up Privy ID
      const privyId = await getPrivyId(auth.userId);
      if (!privyId) {
        logger?.debug(
          { path, userId: auth.userId },
          "credit_auth_no_privy_id"
        );
        return; // Let x402 handle payment
      }

      // Check credit balance
      const credits = await getUserCredits(privyId);

      if (credits < creditCost) {
        logger?.info(
          { path, privyId, credits, required: creditCost },
          "credit_auth_insufficient_credits"
        );
        return; // Let x402 handle payment
      }

      // Deduct credits if immediate mode
      if (immediateDeduct) {
        const deducted = await deductCredits(privyId, creditCost);
        if (!deducted) {
          logger?.warn(
            { path, privyId, creditCost },
            "credit_auth_deduct_failed_fallback_to_x402"
          );
          return; // Let x402 handle payment
        }

        logger?.info(
          { path, privyId, creditCost, remainingCredits: credits - creditCost },
          "credit_auth_credits_deducted"
        );
      }

      // Set bypass flags for x402 middleware
      (request as any).bypassX402 = true;
      (request as any).authenticatedUser = {
        userId: auth.userId,
        privyId,
        authMethod: auth.method,
        creditsPaid: creditCost,
      };

      // Set synthetic x402Settlement so handlers work without modification
      // This allows handlers to use x402Settlement.payer for user identification
      (request as any).x402Settlement = {
        success: true,
        transaction: `credit:${privyId}:${Date.now()}`, // Synthetic "transaction" for tracking
        network: "credits", // Indicates credit-based payment
        payer: auth.userId, // User ID as "payer"
        paymentMethod: "credits",
        creditCost,
      };

      logger?.info(
        {
          path,
          userId: auth.userId,
          privyId,
          authMethod: auth.method,
          creditCost,
        },
        "credit_auth_bypass_x402_set"
      );
    }
  );

  return plugin;
}

export default creditAuthMiddleware;
