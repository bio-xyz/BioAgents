import { Elysia } from "elysia";
import { x402Middleware } from "../../middleware/x402/middleware";
import { create402Response } from "../../middleware/x402/service";
import { authResolver } from "../../middleware/authResolver";
import { deepResearchStartHandler } from "../deep-research/start";
import { getMessage, getState } from "../../db/operations";
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
 * - GET /status: FREE, no payment, no auth — messageId UUID is the security token
 *   (same pattern as /api/chat/status/:jobId — unguessable UUID = authorization)
 * - GET /start: Returns 402 with payment requirements (discovery)
 */

export const x402DeepResearchRoute = new Elysia()
  // Status endpoint - FREE, no payment, no auth required
  // The unguessable messageId UUID (only returned to the payer) serves as the auth token
  // This follows the same pattern as /api/chat/status/:jobId
  .get(
    "/api/x402/deep-research/status/:messageId",
    async ({ params, set }: any) => {
      const messageId = params.messageId;

      if (!messageId) {
        set.status = 400;
        return { ok: false, error: "Missing required parameter: messageId" };
      }

      try {
        // Fetch the message
        const message = await getMessage(messageId);
        if (!message) {
          set.status = 404;
          return { ok: false, error: "Message not found" };
        }

        // No ownership check — messageId UUID is unguessable and only returned to the payer

        // Fetch the state
        const stateId = message.state_id;
        if (!stateId) {
          set.status = 500;
          return { ok: false, error: "Message has no associated state" };
        }

        const state = await getState(stateId);
        if (!state) {
          set.status = 404;
          return { ok: false, error: "State not found" };
        }

        // Determine status based on state values
        const stateValues = state.values || {};
        const steps = stateValues.steps || {};

        // Check if there's an error
        if (stateValues.status === "failed" || stateValues.error) {
          return {
            status: "failed",
            messageId,
            conversationId: message.conversation_id,
            error: stateValues.error || "Deep research failed",
          };
        }

        // Check if completed (finalResponse exists and no active steps)
        const hasActiveSteps = Object.values(steps).some(
          (step: any) => step.start && !step.end,
        );

        if (stateValues.finalResponse && !hasActiveSteps) {
          const rawFiles = stateValues.rawFiles;
          const fileMetadata =
            rawFiles?.length > 0
              ? rawFiles.map((f: any) => ({
                  filename: f.filename,
                  mimeType: f.mimeType,
                  size: f.metadata?.size,
                }))
              : undefined;

          const papers = [
            ...(stateValues.finalPapers || []),
            ...(stateValues.openScholarPapers || []),
            ...(stateValues.semanticScholarPapers || []),
            ...(stateValues.kgPapers || []),
          ];

          return {
            status: "completed",
            messageId,
            conversationId: message.conversation_id,
            result: {
              text: stateValues.finalResponse,
              files: fileMetadata,
              papers: papers.length > 0 ? papers : undefined,
              webSearchResults: stateValues.webSearchResults,
            },
          };
        }

        // Still processing
        const completedSteps = Object.keys(steps).filter(
          (stepName) => steps[stepName].end,
        );
        const currentStep = Object.keys(steps).find(
          (stepName) => steps[stepName].start && !steps[stepName].end,
        );

        return {
          status: "processing",
          messageId,
          conversationId: message.conversation_id,
          progress: {
            currentStep,
            completedSteps,
          },
        };
      } catch (err) {
        logger.error({ err, messageId }, "x402_deep_research_status_check_failed");
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
