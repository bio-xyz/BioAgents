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
 * Both GET and POST return proper x402 402 responses for x402scan compliance.
 *
 * Order matters:
 * 1. x402Middleware - validates payment, sets request.x402Settlement
 * 2. authResolver - reads x402Settlement, sets request.auth with method: "x402"
 */

/**
 * Helper to generate 402 response for x402scan compliance
 */
function generate402Response(request: Request) {
  const pricing = routePricing.find((entry) => "/api/x402/chat".startsWith(entry.route));

  // Build resource URL
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || url.protocol.replace(':', '');
  const resourceUrl = `${protocol}://${url.host}/api/x402/chat`;

  const requirement = x402Service.generatePaymentRequirement(
    resourceUrl,
    pricing?.description || "Chat API access via x402 payment",
    pricing?.priceUSD || "0.01",
    {
      includeOutputSchema: true,
    }
  );

  return new Response(JSON.stringify({
    x402Version: 1,
    accepts: [requirement],
    error: "Payment required",
  }), {
    status: 402,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const x402ChatRoute = new Elysia()
  .use(x402Middleware())
  .onBeforeHandle(authResolver({ required: false })) // Resolves x402Settlement to auth context
  .get("/api/x402/chat", async ({ request, set }) => {
    // Return proper x402 402 response for GET requests (x402scan compliance)
    set.status = 402;
    return generate402Response(request);
  })
  .post("/api/x402/chat", async (ctx: any) => {
    const { request, set, store } = ctx;

    // Check if payment was provided and validated by x402Middleware
    // If no x402Settlement, return 402 (for x402scan compliance)
    // Check both store (Elysia preferred) and request (fallback)
    const x402Settlement = store?.x402Settlement || (request as any).x402Settlement;
    if (!x402Settlement) {
      set.status = 402;
      return generate402Response(request);
    }

    // Payment verified, proceed to chat handler
    return chatHandler(ctx);
  });
