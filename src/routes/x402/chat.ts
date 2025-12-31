import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { x402Service } from "../../middleware/x402/service";
import { routePricing } from "../../middleware/x402/pricing";
import { authResolver } from "../../middleware/authResolver";
import { chatHandler } from "../chat";

/**
 * x402 Chat Route - Payment-gated chat endpoint
 *
 * Uses x402 payment protocol instead of API key authentication.
 * Reuses the same chatHandler logic as the standard /api/chat route.
 *
 * Flow:
 * - GET: Returns 402 with payment requirements (x402scan discovery)
 * - POST without payment: Middleware returns 402
 * - POST with valid payment: Middleware validates, then chatHandler processes
 */

/**
 * Generate 402 response with x402-compliant schema for discovery
 */
function generate402Response(request: Request) {
  const pricing = routePricing.find((entry) => "/api/x402/chat".startsWith(entry.route));

  // Build resource URL with correct protocol
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const resourceUrl = `${protocol}://${url.host}/api/x402/chat`;

  const requirement = x402Service.generatePaymentRequirement(
    resourceUrl,
    pricing?.description || "Chat API access via x402 payment",
    pricing?.priceUSD || "0.01",
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

export const x402ChatRoute = new Elysia()
  // GET endpoint for x402scan discovery - returns 402 with schema
  .get("/api/x402/chat", async ({ request }) => {
    return generate402Response(request);
  })
  // POST endpoint with payment validation
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false }))
  .post("/api/x402/chat", async (ctx: any) => {
    const { body, request } = ctx;
    const x402Settlement = (request as any).x402Settlement;

    // If no valid payment settlement, return 402 (x402scan compliance)
    // This handles cases where middleware is disabled or payment wasn't provided
    if (!x402Settlement) {
      return generate402Response(request);
    }

    // Handle x402scan test requests (valid payment but no message)
    // x402scan sends POST with payment to verify it works, but no actual body
    const message = (body as any)?.message;
    if (!message) {
      // Payment was validated - return success matching outputSchema
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
