import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { deepResearchStartHandler } from "../deep-research/start";
import { deepResearchStatusHandler } from "../deep-research/status";

/**
 * x402 Deep Research Routes - Payment-gated deep research endpoints
 *
 * Uses x402 payment protocol instead of API key authentication.
 * Reuses the same handler logic as the standard deep-research routes.
 *
 * Security:
 * - POST /start: Requires x402 payment
 * - GET /status: Free (no payment), but requires userId query param
 *   Handler validates ownership (message.user_id === userId)
 */
export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - NO payment required, but has ownership validation in handler
  // Must be registered BEFORE x402Middleware to avoid payment requirement
  .get("/api/x402/deep-research/status/:messageId", deepResearchStatusHandler)
  // Payment-gated endpoints
  .use(x402Middleware())
  .get("/api/x402/deep-research/start", async () => {
    return {
      message: "This endpoint requires POST method with x402 payment.",
      apiDocumentation: "https://your-docs-url.com/api",
      paymentInfo: "Include X-PAYMENT header with valid payment proof",
    };
  })
  .post("/api/x402/deep-research/start", deepResearchStartHandler);
