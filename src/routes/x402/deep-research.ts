import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { deepResearchStartHandler } from "../deep-research/start";
import { getDeepResearchStatus } from "../deep-research/statusUtils";
import { verifyPollToken } from "../../services/pollToken";
import { extractBearerToken } from "../../services/jwt";
import logger from "../../utils/logger";

/**
 * x402 V2 Deep Research Routes - Payment-gated access to the full BIOS orchestrator
 *
 * Exposes the complete deep research system (all subagents: planning, literature,
 * analysis, hypothesis, reflection, discovery, reply) via x402 payment protocol.
 *
 * The orchestrator runs iterative research cycles asynchronously. Results are
 * persisted to DB and polled via the status endpoint.
 *
 * Security model:
 * - POST /start: Requires x402 payment — this is the ONLY paid endpoint
 * - GET /status: FREE, no payment — requires signed poll token (issued at start)
 * - GET /start: Returns 402 with payment requirements (discovery)
 */

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment required, but requires signed poll token
  // The poll token is issued when the job starts and returned to the payer
  .get(
    "/api/x402/deep-research/status/:messageId",
    async ({ params, set, request }: any) => {
      const messageId = params.messageId;

      if (!messageId) {
        set.status = 400;
        return { ok: false, error: "Missing required parameter: messageId" };
      }

      // Extract poll token from query param or Authorization header
      const url = new URL(request.url);
      const tokenFromQuery = url.searchParams.get("token");
      const tokenFromHeader = extractBearerToken(
        request.headers.get("Authorization"),
      );
      const token = tokenFromQuery || tokenFromHeader;

      if (!token) {
        set.status = 401;
        return {
          ok: false,
          error: "Poll token required",
          hint: "Include ?token=<pollToken> query param or Authorization: Bearer <pollToken> header",
        };
      }

      // Verify the poll token
      const verification = await verifyPollToken(token);
      if (!verification.valid) {
        set.status = 401;
        return {
          ok: false,
          error: verification.error || "Invalid poll token",
        };
      }

      // Validate that the token's messageId matches the route parameter
      if (verification.messageId !== messageId) {
        logger.warn(
          {
            tokenMessageId: verification.messageId,
            routeMessageId: messageId,
          },
          "x402_poll_token_messageId_mismatch",
        );
        set.status = 403;
        return {
          ok: false,
          error: "Poll token does not match requested messageId",
        };
      }

      // Token is valid and matches — fetch status using shared utility
      try {
        const { response, httpStatus } =
          await getDeepResearchStatus(messageId);
        set.status = httpStatus;
        return response;
      } catch (err) {
        logger.error(
          { err, messageId },
          "x402_deep_research_status_check_failed",
        );
        set.status = 500;
        return { ok: false, error: "Failed to check deep research status" };
      }
    },
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
