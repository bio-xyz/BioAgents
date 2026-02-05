import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { chatHandler } from "../chat";

/**
 * x402 V2 Chat Route - Payment-gated chat endpoint
 *
 * Uses x402 V2 payment protocol instead of API key authentication.
 * Reuses the same chatHandler logic as the standard /api/chat route.
 *
 * Flow:
 * - GET: Returns 402 with payment requirements (discovery)
 * - POST without payment: Middleware returns 402
 * - POST with valid payment: Middleware validates, then chatHandler processes
 */

export const x402ChatRoute = new Elysia()
  // GET endpoint for discovery - returns 402 with schema
  .get("/api/x402/chat", async ({ request }) => {
    return create402Response(request, "/api/x402/chat");
  })
  // POST endpoint with payment validation
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))
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
