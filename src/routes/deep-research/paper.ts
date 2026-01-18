/**
 * Paper Routes for Deep Research
 *
 * POST /api/deep-research/conversations/:conversationId/paper
 *   - Generates a LaTeX paper from a Deep Research conversation (sync)
 *
 * POST /api/deep-research/conversations/:conversationId/paper/async
 *   - Queues paper generation job (async, returns immediately)
 *
 * GET /api/deep-research/paper/:paperId/status
 *   - Gets the status of a paper generation job
 *
 * GET /api/deep-research/paper/:paperId
 *   - Gets a fresh presigned URL for an existing paper
 *
 * GET /api/deep-research/conversations/:conversationId/papers
 *   - Lists all papers for a conversation
 */

import { randomUUID } from "crypto";
import { Elysia } from "elysia";
import { getServiceClient } from "../../db/client";
import { getConversation } from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import { isJobQueueEnabled } from "../../services/queue/connection";
import { generatePaperFromConversation } from "../../services/paper/generatePaper";
import { getStorageProvider } from "../../storage";
import type { AuthContext } from "../../types/auth";
import logger from "../../utils/logger";

// Use service client to bypass RLS - auth is verified by middleware
const supabase = getServiceClient();

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
      // Sync paper generation (blocking)
      .post(
        "/api/deep-research/conversations/:conversationId/paper",
        paperGenerationHandler,
      )
      // Async paper generation (queue-based)
      .post(
        "/api/deep-research/conversations/:conversationId/paper/async",
        asyncPaperGenerationHandler,
      )
      // Paper job status
      .get("/api/deep-research/paper/:paperId/status", paperStatusHandler)
      // Get paper with fresh presigned URLs
      .get("/api/deep-research/paper/:paperId", getPaperHandler)
      // List all papers for a conversation
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
      .select("id, pdf_path, created_at, status")
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
          status: p.status,
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

/**
 * Check if user has any concurrent paper generation jobs
 */
async function checkUserHasConcurrentPaperJob(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("paper")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .limit(1);

  if (error) {
    logger.error({ error, userId }, "failed_to_check_concurrent_paper_jobs");
    return false; // Allow on error (fail open)
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Check if global concurrent paper job limit is reached
 */
async function checkGlobalConcurrentPaperLimit(): Promise<{ exceeded: boolean; current: number }> {
  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PAPER_JOBS || "3");

  const { count, error } = await supabase
    .from("paper")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "processing"]);

  if (error) {
    logger.error({ error }, "failed_to_check_global_concurrent_paper_jobs");
    return { exceeded: false, current: 0 }; // Allow on error (fail open)
  }

  const current = count ?? 0;
  return { exceeded: current >= maxConcurrent, current };
}

/**
 * Async paper generation handler - queues job and returns immediately
 */
async function asyncPaperGenerationHandler(ctx: any) {
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

  // Check if queue is enabled
  if (!isJobQueueEnabled()) {
    set.status = 503;
    return {
      error: "Async paper generation unavailable",
      message: "Job queue is not enabled. Use the sync endpoint instead.",
      syncEndpoint: `/api/deep-research/conversations/${conversationId}/paper`,
    };
  }

  logger.info(
    {
      conversationId,
      userId,
      authMethod: auth?.method,
    },
    "async_paper_generation_request",
  );

  try {
    // Verify conversation ownership
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
        message: "You do not have permission to generate a paper for this conversation",
      };
    }

    // Check for concurrent paper jobs for this user
    const hasConcurrentJob = await checkUserHasConcurrentPaperJob(userId);
    if (hasConcurrentJob) {
      set.status = 429;
      return {
        error: "Concurrent paper limit exceeded",
        message: "You already have a paper generation job in progress. Please wait for it to complete.",
      };
    }

    // Check global concurrent paper job limit
    const globalLimit = await checkGlobalConcurrentPaperLimit();
    if (globalLimit.exceeded) {
      const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PAPER_JOBS || "3");
      set.status = 429;
      return {
        error: "System busy",
        message: `The system is currently processing ${globalLimit.current} paper generation jobs. Maximum allowed is ${maxConcurrent}. Please try again later.`,
      };
    }

    // Create paper record with 'pending' status
    const paperId = randomUUID();
    const pdfPath = `user/${userId}/conversation/${conversationId}/papers/${paperId}/paper.pdf`;

    const { error: insertError } = await supabase.from("paper").insert({
      id: paperId,
      user_id: userId,
      conversation_id: conversationId,
      pdf_path: pdfPath,
      status: "pending",
    });

    if (insertError) {
      logger.error({ insertError }, "failed_to_create_paper_record");
      set.status = 500;
      return {
        error: "Failed to create paper record",
        message: insertError.message,
      };
    }

    // Enqueue job
    const { getPaperGenerationQueue } = await import("../../services/queue/queues");
    const queue = getPaperGenerationQueue();

    const job = await queue.add(
      `paper-${paperId}`,
      {
        paperId,
        userId,
        conversationId,
        authMethod: auth?.method || "anonymous",
        requestedAt: new Date().toISOString(),
      },
      {
        jobId: paperId, // Use paperId as job ID for easy lookup
      },
    );

    logger.info(
      { jobId: job.id, paperId, conversationId },
      "paper_generation_job_enqueued",
    );

    // Return 202 Accepted
    set.status = 202;
    return {
      success: true,
      paperId,
      jobId: job.id,
      conversationId,
      status: "queued",
      statusUrl: `/api/deep-research/paper/${paperId}/status`,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        conversationId,
        userId,
      },
      "async_paper_generation_failed",
    );

    set.status = 500;
    return {
      error: "Failed to queue paper generation",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Paper status handler - returns job progress
 */
async function paperStatusHandler(ctx: any) {
  const { params, set, request } = ctx;
  const paperId = params.paperId;

  // Get authenticated user from auth context
  const auth = (request as any).auth as AuthContext | undefined;
  const userId = auth?.userId;

  if (!userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Valid authentication is required to check paper status",
    };
  }

  if (!paperId) {
    set.status = 400;
    return {
      error: "Missing paperId",
      message: "paperId must be provided in the route",
    };
  }

  logger.info({ paperId, userId }, "paper_status_request");

  try {
    // Fetch paper record
    const { data: paper, error } = await supabase
      .from("paper")
      .select("*")
      .eq("id", paperId)
      .single();

    if (error || !paper) {
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

    // Build response based on status
    const response: any = {
      paperId: paper.id,
      conversationId: paper.conversation_id,
      status: paper.status,
      createdAt: paper.created_at,
    };

    if (paper.progress) {
      response.progress = paper.progress;
    }

    if (paper.status === "completed") {
      // Generate fresh presigned URLs
      const storage = getStorageProvider();
      if (storage) {
        response.pdfUrl = await storage.getPresignedUrl(paper.pdf_path, 3600);
        const rawLatexPath = paper.pdf_path.replace("/paper.pdf", "/main.tex");
        try {
          if (await storage.exists(rawLatexPath)) {
            response.rawLatexUrl = await storage.getPresignedUrl(rawLatexPath, 3600);
          }
        } catch {
          // LaTeX file may not exist
        }
      }
    }

    if (paper.status === "failed") {
      response.error = paper.error;
    }

    logger.info({ paperId, userId, status: paper.status }, "paper_status_returned");

    return response;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        paperId,
        userId,
      },
      "paper_status_check_failed",
    );

    set.status = 500;
    return {
      error: "Failed to check paper status",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
