import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { deepResearchStartHandler } from "../deep-research/start";
import { deepResearchStatusHandler } from "../deep-research/status";

/**
 * x402 V2 Deep Research Routes - Payment-gated deep research endpoints
 *
 * Uses x402 V2 payment protocol instead of API key authentication.
 * Reuses the same handler logic as the standard deep-research routes.
 *
 * Security:
 * - GET /start: Returns 402 with payment requirements (discovery)
 * - POST /start: Requires x402 payment (handled by x402Middleware)
 * - GET /status: Free (no payment), but requires userId query param
 */

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment required (ownership validated in handler)
  .get("/api/x402/deep-research/status/:messageId", deepResearchStatusHandler)
  // GET /start for discovery - returns 402 with schema
  .get("/api/x402/deep-research/start", async ({ request }) => {
    return create402Response(request, "/api/x402/deep-research/start");
  })
  // POST /start with payment validation
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))
  .post("/api/x402/deep-research/start", async (ctx: any) => {
    const { body, request } = ctx;
    const x402Settlement = (request as any).x402Settlement;

    // If no valid payment settlement, return 402
    if (!x402Settlement) {
      return create402Response(request, "/api/x402/deep-research/start");
    }

    // Handle test requests (valid payment but no query)
    const query = (body as any)?.query;
    if (!query) {
      // Payment was validated - return success
      return {
        text: `Payment verified successfully. Transaction: ${x402Settlement.transaction}`,
        userId: x402Settlement.payer,
        conversationId: null,
        pollUrl: null,
      };
    }

    // Has query - process as normal deep research request
    return deepResearchStartHandler(ctx);
  });
