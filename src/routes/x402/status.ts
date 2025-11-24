import { Elysia } from "elysia";
import logger from "../../utils/logger";
import { getMessage, getState } from "../../db/operations";

type DeepResearchStatusResponse = {
  status: "processing" | "completed" | "failed";
  messageId: string;
  conversationId: string;
  result?: {
    text: string;
    files?: Array<{
      filename: string;
      mimeType: string;
      size?: number;
    }>;
    papers?: any[];
    webSearchResults?: any[];
  };
  error?: string;
  progress?: {
    currentStep?: string;
    completedSteps?: string[];
  };
};

/**
 * x402 Deep Research Status Route
 *
 * Check progress of an x402 deep research job
 * - No authentication required
 * - Checks message and state from x402_agent source
 */
const x402ResearchStatusPlugin = new Elysia();

export const x402ResearchStatusRoute = x402ResearchStatusPlugin.get(
  "/api/x402/research/status/:messageId",
  async (ctx) => {
    const { params, set } = ctx as any;
    const messageId = params.messageId;

    if (!messageId) {
      set.status = 400;
      return {
        ok: false,
        error: "Missing required parameter: messageId",
      };
    }

    try {
      if (logger) {
        logger.info({ messageId, source: "x402" }, "x402_research_status_check");
      }

      // Fetch the message
      const message = await getMessage(messageId);
      if (!message) {
        set.status = 404;
        return {
          ok: false,
          error: "Message not found",
        };
      }

      // Verify this is an x402 message
      if (message.source !== "x402_agent") {
        set.status = 403;
        return {
          ok: false,
          error: "This endpoint is for x402 research requests only",
        };
      }

      // Fetch the state
      const stateId = message.state_id;
      if (!stateId) {
        set.status = 500;
        return {
          ok: false,
          error: "Message has no associated state",
        };
      }

      const state = await getState(stateId);
      if (!state) {
        set.status = 404;
        return {
          ok: false,
          error: "State not found",
        };
      }

      // Determine status based on state values
      const stateValues = state.values || {};
      const steps = stateValues.steps || {};

      // Check if there's an error
      if (stateValues.status === "failed" || stateValues.error) {
        const response: DeepResearchStatusResponse = {
          status: "failed",
          messageId,
          conversationId: message.conversation_id,
          error: stateValues.error || "Deep research failed",
        };

        if (logger) {
          logger.info(
            { messageId, conversationId: message.conversation_id },
            "x402_research_failed"
          );
        }

        return response;
      }

      // Check if completed (finalResponse exists and no active steps)
      const hasActiveSteps = Object.values(steps).some(
        (step: any) => step.start && !step.end,
      );

      if (stateValues.finalResponse && !hasActiveSteps) {
        // Completed
        const rawFiles = stateValues.rawFiles;
        const fileMetadata =
          rawFiles?.length > 0
            ? rawFiles.map((f: any) => ({
                filename: f.filename,
                mimeType: f.mimeType,
                size: f.metadata?.size,
              }))
            : undefined;

        // Get unique papers from various sources
        const papers = [
          ...(stateValues.finalPapers || []),
          ...(stateValues.openScholarPapers || []),
          ...(stateValues.semanticScholarPapers || []),
          ...(stateValues.kgPapers || []),
        ];

        const response: DeepResearchStatusResponse = {
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

        if (logger) {
          logger.info(
            { messageId, conversationId: message.conversation_id },
            "x402_research_completed"
          );
        }

        return response;
      }

      // Still processing
      const completedSteps = Object.keys(steps).filter(
        (stepName) => steps[stepName].end,
      );
      const currentStep = Object.keys(steps).find(
        (stepName) => steps[stepName].start && !steps[stepName].end,
      );

      const response: DeepResearchStatusResponse = {
        status: "processing",
        messageId,
        conversationId: message.conversation_id,
        progress: {
          currentStep,
          completedSteps,
        },
      };

      if (logger) {
        logger.info(
          {
            messageId,
            conversationId: message.conversation_id,
            currentStep,
            completedStepsCount: completedSteps.length,
          },
          "x402_research_processing"
        );
      }

      return response;
    } catch (err) {
      logger.error({ err, messageId }, "x402_research_status_check_failed");
      set.status = 500;
      return {
        ok: false,
        error: "Failed to check deep research status",
      };
    }
  },
);
