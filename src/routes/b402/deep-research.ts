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
 *
 * TODO: b402 deep research has been deprioritized but needs the following work:
 * 1. The status endpoint is currently broken — it calls deepResearchStatusHandler
 *    which requires request.auth from authResolver middleware, but no auth middleware
 *    runs on this route (registered before b402Middleware). This means it always returns 401.
 * 2. authResolver does not recognize b402Settlement (only x402Settlement), so even if
 *    b402Middleware runs, the auth context won't be populated with b402 payer info.
 * 3. Should adopt the same signed poll token mechanism as the x402 deep research route
 *    (see src/routes/x402/deep-research.ts and src/services/pollToken.ts).
 */
export const b402DeepResearchRoute = new Elysia()
  // TODO: Status endpoint is broken — deepResearchStatusHandler requires auth context
  // that is never set on this route. Needs poll token validation like x402 route.
  // See src/routes/x402/deep-research.ts for the correct pattern.
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
