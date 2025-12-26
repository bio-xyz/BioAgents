/**
 * Paper Generation Route for Deep Research
 *
 * POST /api/deep-research/conversations/:conversationId/paper
 *
 * Generates a LaTeX paper from a Deep Research conversation, compiles to PDF,
 * uploads to storage, and persists metadata to database.
 */

import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import type { AuthContext } from "../../types/auth";
import logger from "../../utils/logger";
import { generatePaperFromConversation } from "../../services/paper/generatePaper";

/**
 * Paper generation route with auth guard
 */
export const deepResearchPaperRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true, // Always require auth for paper generation
      }),
    ],
  },
  (app) =>
    app.post(
      "/api/deep-research/conversations/:conversationId/paper",
      paperGenerationHandler,
    ),
);

/**
 * Paper generation handler
 */
async function paperGenerationHandler(ctx: any) {
  const { params, set, request } = ctx;
  const conversationId = params.conversationId;

  // Get authenticated user from auth context
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Valid authentication is required to generate papers",
    };
  }

  if (!conversationId) {
    set.status = 400;
    return {
      error: "Missing conversationId",
      message: "conversationId must be provided in the route",
    };
  }

  logger.info(
    {
      conversationId,
      userId,
      authMethod: auth?.method,
    },
    "paper_generation_request",
  );

  try {
    // Generate paper (synchronous operation)
    const result = await generatePaperFromConversation(conversationId, userId);

    logger.info(
      {
        paperId: result.paperId,
        conversationId: result.conversationId,
      },
      "paper_generated_successfully",
    );

    return {
      success: true,
      paperId: result.paperId,
      conversationId: result.conversationId,
      conversationStateId: result.conversationStateId,
      pdfPath: result.pdfPath,
      pdfUrl: result.pdfUrl,
      sourceZipUrl: result.sourceZipUrl,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        conversationId,
        userId,
      },
      "paper_generation_failed",
    );

    // Determine appropriate status code and error message
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("not found")) {
      set.status = 404;
      return {
        error: "Resource not found",
        message: errorMessage,
      };
    }

    if (errorMessage.includes("does not own")) {
      set.status = 403;
      return {
        error: "Access denied",
        message: "You do not have permission to generate a paper for this conversation",
      };
    }

    if (errorMessage.includes("compilation failed")) {
      set.status = 500;
      return {
        error: "LaTeX compilation failed",
        message: errorMessage,
        hint: "The paper content could not be compiled to PDF. Check the LaTeX syntax and citations.",
      };
    }

    // Generic server error
    set.status = 500;
    return {
      error: "Paper generation failed",
      message: errorMessage,
    };
  }
}
