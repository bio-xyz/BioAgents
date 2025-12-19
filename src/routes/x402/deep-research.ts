import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { x402Service } from "../../middleware/x402/service";
import { routePricing } from "../../middleware/x402/pricing";
import { authResolver } from "../../middleware/authResolver";
import { deepResearchStartHandler } from "../deep-research/start";
import { deepResearchStatusHandler } from "../deep-research/status";

/**
 * x402 Deep Research Routes - Payment-gated deep research endpoints
 *
 * Uses x402 payment protocol instead of API key authentication.
 * Reuses the same handler logic as the standard deep-research routes.
 *
 * Security:
 * - GET /start: Returns 402 with payment requirements (x402scan discovery)
 * - POST /start: Requires x402 payment (handled by x402Middleware)
 * - GET /status: Free (no payment), but requires userId query param
 */

/**
 * Generate 402 response with x402-compliant schema for discovery
 */
function generate402Response(request: Request) {
  const pricing = routePricing.find((entry) =>
    "/api/x402/deep-research/start".startsWith(entry.route)
  );

  // Build resource URL with correct protocol
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const resourceUrl = `${protocol}://${url.host}/api/x402/deep-research/start`;

  const requirement = x402Service.generatePaymentRequirement(
    resourceUrl,
    pricing?.description || "Deep research initiation via x402 payment",
    pricing?.priceUSD || "0.025",
    { includeOutputSchema: true }
  );

  return new Response(
    JSON.stringify({
      x402Version: 1,
      accepts: [requirement],
      error: "Payment required",
    }),
    {
      status: 402,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment required (ownership validated in handler)
  .get("/api/x402/deep-research/status/:messageId", deepResearchStatusHandler)
  // GET /start for x402scan discovery - returns 402 with schema
  .get("/api/x402/deep-research/start", async ({ request }) => {
    return generate402Response(request);
  })
  // POST /start with payment validation
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))
  .post("/api/x402/deep-research/start", async (ctx: any) => {
    const { body, request } = ctx;
    const x402Settlement = (request as any).x402Settlement;

    // If no valid payment settlement, return 402 (x402scan compliance)
    // This handles cases where middleware is disabled or payment wasn't provided
    if (!x402Settlement) {
      return generate402Response(request);
    }

    // Handle x402scan test requests (valid payment but no query)
    // x402scan sends POST with payment to verify it works, but no actual body
    const query = (body as any)?.query;
    if (!query) {
      // Payment was validated - return success matching outputSchema
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
