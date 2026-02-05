import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { creditAuthMiddleware } from "../../middleware/creditAuth";
import { chatHandler } from "../chat";

/**
 * x402 V2 Chat Route - Payment-gated chat endpoint
 *
 * Uses x402 V2 payment protocol instead of API key authentication.
 * Reuses the same chatHandler logic as the standard /api/chat route.
 *
 * Supports two payment methods:
 * 1. Credits (Privy-authenticated users): Deducts from user's credit balance
 * 2. x402 (crypto payment): Direct USDC payment via x402 protocol
 *
 * Flow:
 * - GET: Returns 402 with payment requirements (discovery)
 * - POST with Privy auth + credits: creditAuthMiddleware bypasses x402
 * - POST with x402 payment: x402Middleware validates payment
 * - POST without payment/credits: Returns 402
 */

export const x402ChatRoute = new Elysia()
  // GET endpoint for discovery - returns 402 with schema
  .get("/api/x402/chat", async ({ request }) => {
    return create402Response(request, "/api/x402/chat");
  })
  // POST endpoint with payment validation
  // Order matters: authResolver -> creditAuth -> x402Middleware
  .onBeforeHandle(authResolver({ required: false }))
  .use(creditAuthMiddleware({ creditCost: 1 }))
  .use(x402Middleware())
  .post("/api/x402/chat", async (ctx: any) => {
    const { body, request } = ctx;
    const x402Settlement = (request as any).x402Settlement;

    // If no valid payment settlement, return 402
    if (!x402Settlement) {
      return create402Response(request, "/api/x402/chat");
    }

    // Handle test requests (valid payment but no message)
    const message = (body as any)?.message;
    if (!message) {
      // Payment was validated - return success
      return {
        text: `Payment verified successfully. Transaction: ${x402Settlement.transaction}`,
        userId: x402Settlement.payer,
        conversationId: null,
        pollUrl: null,
      };
    }

    // Has message - process as normal chat request
    return chatHandler(ctx);
  });
