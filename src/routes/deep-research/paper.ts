/**
 * Paper Routes for Deep Research
 *
 * POST /api/deep-research/conversations/:conversationId/paper
 *   - Generates a LaTeX paper from a Deep Research conversation
 *
 * GET /api/deep-research/paper/:paperId
 *   - Gets a fresh presigned URL for an existing paper
 *
 * GET /api/deep-research/conversations/:conversationId/papers
 *   - Lists all papers for a conversation
 */

import { createClient } from "@supabase/supabase-js";
import { Elysia } from "elysia";
import { getConversation } from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import { generatePaperFromConversation } from "../../services/paper/generatePaper";
import { getStorageProvider } from "../../storage";
import type { AuthContext } from "../../types/auth";
import logger from "../../utils/logger";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

/**
 * Paper routes with auth guard
 */
export const deepResearchPaperRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true, // Always require auth for paper operations
      }),
    ],
  },
  (app) =>
    app
      .post(
        "/api/deep-research/conversations/:conversationId/paper",
        paperGenerationHandler,
      )
      .get("/api/deep-research/paper/:paperId", getPaperHandler)
      .get(
        "/api/deep-research/conversations/:conversationId/papers",
        listPapersHandler,
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
      rawLatexUrl: result.rawLatexUrl,
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
        message:
          "You do not have permission to generate a paper for this conversation",
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

/**
 * Get paper handler - generates fresh presigned URLs for an existing paper
 */
async function getPaperHandler(ctx: any) {
  const { params, set, request } = ctx;
  const paperId = params.paperId;

  // Get authenticated user from auth context
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Valid authentication is required to access papers",
    };
  }

  if (!paperId) {
    set.status = 400;
    return {
      error: "Missing paperId",
      message: "paperId must be provided in the route",
    };
  }

  logger.info({ paperId, userId }, "paper_get_request");

  try {
    // Fetch paper from database
    const { data: paper, error: fetchError } = await supabase
      .from("paper")
      .select("*")
      .eq("id", paperId)
      .single();

    if (fetchError || !paper) {
      set.status = 404;
      return {
        error: "Paper not found",
        message: `Paper with id ${paperId} not found`,
      };
    }

    // Verify ownership
    if (paper.user_id !== userId) {
      set.status = 403;
      return {
        error: "Access denied",
        message: "You do not have permission to access this paper",
      };
    }

    // Get storage provider and generate fresh presigned URLs
    const storage = getStorageProvider();
    if (!storage) {
      set.status = 500;
      return {
        error: "Storage unavailable",
        message: "Storage provider is not configured",
      };
    }

    const pdfUrl = await storage.getPresignedUrl(paper.pdf_path, 3600);

    // Generate LaTeX URL if path exists (derive from pdf_path)
    const rawLatexPath = paper.pdf_path.replace("/paper.pdf", "/main.tex");
    let rawLatexUrl: string | null = null;
    try {
      if (await storage.exists(rawLatexPath)) {
        rawLatexUrl = await storage.getPresignedUrl(rawLatexPath, 3600);
      }
    } catch {
      // LaTeX file may not exist for older papers
    }

    logger.info({ paperId, userId }, "paper_urls_generated");

    return {
      success: true,
      paperId: paper.id,
      conversationId: paper.conversation_id,
      pdfPath: paper.pdf_path,
      pdfUrl,
      rawLatexUrl,
      createdAt: paper.created_at,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        paperId,
        userId,
      },
      "paper_get_failed",
    );

    set.status = 500;
    return {
      error: "Failed to get paper",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List papers handler - returns all papers for a conversation
 */
async function listPapersHandler(ctx: any) {
  const { params, set, request } = ctx;
  const conversationId = params.conversationId;

  // Get authenticated user from auth context
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Valid authentication is required to list papers",
    };
  }

  if (!conversationId) {
    set.status = 400;
    return {
      error: "Missing conversationId",
      message: "conversationId must be provided in the route",
    };
  }

  logger.info({ conversationId, userId }, "list_papers_request");

  try {
    // Verify the user owns this conversation
    const conversation = await getConversation(conversationId);

    if (!conversation) {
      set.status = 404;
      return {
        error: "Conversation not found",
        message: `Conversation with id ${conversationId} not found`,
      };
    }

    if (conversation.user_id !== userId) {
      set.status = 403;
      return {
        error: "Access denied",
        message: "You do not have permission to access this conversation",
      };
    }

    // Fetch all papers for this conversation
    const { data: papers, error: papersError } = await supabase
      .from("paper")
      .select("id, pdf_path, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false });

    if (papersError) {
      throw new Error(`Failed to fetch papers: ${papersError.message}`);
    }

    logger.info(
      { conversationId, userId, count: papers?.length || 0 },
      "papers_listed",
    );

    return {
      success: true,
      conversationId,
      papers:
        papers?.map((p) => ({
          paperId: p.id,
          pdfPath: p.pdf_path,
          createdAt: p.created_at,
        })) || [],
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        userId,
      },
      "list_papers_failed",
    );

    set.status = 500;
    return {
      error: "Failed to list papers",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
