import { Elysia } from "elysia";
import { b402Middleware } from "../../middleware/b402/middleware";
import { deepResearchStartHandler } from "../deep-research/start";
import { deepResearchStatusHandler } from "../deep-research/status";

/**
 * b402 Deep Research Routes - Payment-gated deep research endpoints (BNB Chain)
 *
 * Uses b402 payment protocol (USDT on BNB Chain) instead of API key authentication.
 * Reuses the same handler logic as the standard deep-research routes.
 *
 * Security:
 * - POST /start: Requires b402 payment
 * - GET /status: Free (no payment), but requires userId query param
 *   Handler validates ownership (message.user_id === userId)
 */
export const b402DeepResearchRoute = new Elysia()
  // Status endpoint - NO payment required, but has ownership validation in handler
  // Must be registered BEFORE b402Middleware to avoid payment requirement
  .get("/api/b402/deep-research/status/:messageId", deepResearchStatusHandler)
  // Payment-gated endpoints
  .use(b402Middleware())
  .get("/api/b402/deep-research/start", async () => {
    return {
      message: "This endpoint requires POST method with b402 payment.",
      apiDocumentation: "https://your-docs-url.com/api",
      paymentInfo: "Include X-PAYMENT header with valid payment proof (BNB Chain)",
    };
  })
  .post("/api/b402/deep-research/start", deepResearchStartHandler);
