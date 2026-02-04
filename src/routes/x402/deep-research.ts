import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { x402Service } from "../../middleware/x402/service";
import { routePricing } from "../../middleware/x402/pricing";
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

/**
 * Generate 402 response with x402 V2 compliant schema
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

  const paymentRequired = x402Service.generatePaymentRequired(
    resourceUrl,
    pricing?.description || "Deep research initiation via x402 payment",
    pricing?.priceUSD || "0.025",
    { includeOutputSchema: true }
  );

  // Encode for v2 clients that expect PAYMENT-REQUIRED header
  const paymentRequiredHeader = x402Service.encodePaymentRequiredHeader(paymentRequired);

  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "PAYMENT-REQUIRED": paymentRequiredHeader,
    },
  });
}

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment required (ownership validated in handler)
  .get("/api/x402/deep-research/status/:messageId", deepResearchStatusHandler)
  // GET /start for discovery - returns 402 with schema
  .get("/api/x402/deep-research/start", async ({ request }) => {
    return generate402Response(request);
  })
  // POST /start with payment validation
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))
  .post("/api/x402/deep-research/start", async (ctx: any) => {
    const { body, request } = ctx;
    const x402Settlement = (request as any).x402Settlement;

    // If no valid payment settlement, return 402
    if (!x402Settlement) {
      return generate402Response(request);
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
