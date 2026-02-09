/**
 * Shared Deep Research Status Utilities
 *
 * Core status detection logic (processing/completed/failed) used by:
 * - Standard status endpoint (with auth + ownership)
 * - x402 status endpoint (with poll token)
 *
 * Does NOT perform any auth or ownership checks — callers are responsible.
 */

import { getMessage, getState } from "../../db/operations";

export type DeepResearchStatusResponse = {
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
 * Fetch message and state, then determine deep research status.
 *
 * @param messageId - The message UUID to check
 * @returns { response, httpStatus, message } where message is the DB record (for ownership checks)
 */
export async function getDeepResearchStatus(messageId: string): Promise<{
  response: DeepResearchStatusResponse | { ok: false; error: string };
  httpStatus: number;
  message?: any;
}> {
  // Fetch the message
  const message = await getMessage(messageId);
  if (!message) {
    return {
      response: { ok: false, error: "Message not found" },
      httpStatus: 404,
    };
  }

  // Fetch the state
  const stateId = message.state_id;
  if (!stateId) {
    return {
      response: { ok: false, error: "Message has no associated state" },
      httpStatus: 500,
      message,
    };
  }

  const state = await getState(stateId);
  if (!state) {
    return {
      response: { ok: false, error: "State not found" },
      httpStatus: 404,
      message,
    };
  }

  // Determine status based on state values
  const stateValues = state.values || {};
  const steps = stateValues.steps || {};

  // Check if failed
  if (stateValues.status === "failed" || stateValues.error) {
    return {
      response: {
        status: "failed",
        messageId,
        conversationId: message.conversation_id,
        error: stateValues.error || "Deep research failed",
      },
      httpStatus: 200,
      message,
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
      response: {
        status: "completed",
        messageId,
        conversationId: message.conversation_id,
        result: {
          text: stateValues.finalResponse,
          files: fileMetadata,
          papers: papers.length > 0 ? papers : undefined,
          webSearchResults: stateValues.webSearchResults,
        },
      },
      httpStatus: 200,
      message,
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
    response: {
      status: "processing",
      messageId,
      conversationId: message.conversation_id,
      progress: {
        currentStep,
        completedSteps,
      },
    },
    httpStatus: 200,
    message,
  };
}
