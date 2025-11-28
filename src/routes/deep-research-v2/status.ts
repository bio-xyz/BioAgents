import { Elysia } from "elysia";
import { getMessage, getState } from "../../db/operations";
import { smartAuthMiddleware } from "../../middleware/smartAuth";
import logger from "../../utils/logger";

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
 * Deep Research Status Route - Check progress of a deep research job
 */
const deepResearchStatusPlugin = new Elysia().use(
  smartAuthMiddleware({
    optional: true, // Allow unauthenticated requests (AI agents)
  }),
);

export const deepResearchStatusRoute = deepResearchStatusPlugin.get(
  "/api/deep-research-v2/status/:messageId",
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
      // Fetch the message
      const message = await getMessage(messageId);
      if (!message) {
        set.status = 404;
        return {
          ok: false,
          error: "Message not found",
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

      return response;
    } catch (err) {
      logger.error({ err, messageId }, "deep_research_status_check_failed");
      set.status = 500;
      return {
        ok: false,
        error: "Failed to check deep research status",
      };
    }
  },
);
