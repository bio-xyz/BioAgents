import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { deepResearchStartHandler } from "../deep-research/start";
import { deepResearchStatusHandler } from "../deep-research/status";

/**
 * x402 V2 Deep Research Routes - Payment-gated access to the full BIOS orchestrator
 *
 * Exposes the complete deep research system (all subagents: planning, literature,
 * analysis, hypothesis, reflection, discovery, reply) via x402 payment protocol.
 *
 * The orchestrator runs iterative research cycles asynchronously. Results are
 * persisted to DB and polled via the status endpoint.
 *
 * Security:
 * - GET /start: Returns 402 with payment requirements (discovery)
 * - POST /start: Requires x402 payment (handled by x402Middleware)
 * - GET /status: Free (no payment), requires auth for ownership validation
 */

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment required, but requires auth for ownership check
  .guard(
    { beforeHandle: [authResolver({ required: true })] },
    (app) =>
      app.get(
        "/api/x402/deep-research/status/:messageId",
        deepResearchStatusHandler,
      ),
  )
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

    // Has message - run full orchestrator (all subagents in iterative cycles)
    // Deep research is async and stateful: results persisted to DB, polled via status endpoint
    return deepResearchStartHandler(ctx);
  });
