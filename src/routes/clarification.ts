/**
 * Clarification Routes
 *
 * API endpoints for the pre-research clarification flow:
 * - POST /api/clarification/generate-questions - Generate questions from query
 * - POST /api/clarification/submit-answers - Submit answers, get plan
 * - POST /api/clarification/plan-feedback - Provide feedback or approve plan
 * - GET /api/clarification/:sessionId - Get session state
 */

import { Elysia } from "elysia";
import {
  clarificationPlanAgent,
  clarificationPlanRegenerateAgent,
  clarificationQuestionsAgent,
} from "../agents/clarification";
import {
  addPlanFeedback,
  approveClarificationPlan,
  createClarificationSession,
  getClarificationSessionForUser,
  setClarificationPlan,
  submitClarificationAnswers,
} from "../db/clarification";
import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import type {
  ClarificationAnswer,
  ClarificationPlan,
  ClarificationQuestion,
} from "../types/clarification";
import logger from "../utils/logger";

/**
 * Response type for generate-questions endpoint
 */
type GenerateQuestionsResponse = {
  ok: boolean;
  sessionId?: string;
  questions?: ClarificationQuestion[];
  reasoning?: string;
  error?: string;
};

/**
 * Response type for submit-answers endpoint
 */
type SubmitAnswersResponse = {
  ok: boolean;
  sessionId?: string;
  plan?: ClarificationPlan;
  error?: string;
};

/**
 * Response type for plan-feedback endpoint
 */
type PlanFeedbackResponse = {
  ok: boolean;
  sessionId?: string;
  plan?: ClarificationPlan;
  approved?: boolean;
  error?: string;
};

/**
 * Response type for get session endpoint
 */
type GetSessionResponse = {
  ok: boolean;
  session?: {
    id: string;
    status: string;
    initial_query: string;
    questions: ClarificationQuestion[];
    answers: ClarificationAnswer[];
    plan: ClarificationPlan | null;
    created_at: string;
    updated_at: string;
  };
  error?: string;
};

/**
 * Clarification Route - Pre-research clarification flow
 * Uses guard pattern to ensure auth runs for all routes
 */
export const clarificationRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true,
      }),
      rateLimitMiddleware("chat"), // Use chat rate limit
    ],
  },
  (app) =>
    app
      // Generate clarification questions from a query
      .post(
        "/api/clarification/generate-questions",
        async (ctx): Promise<GenerateQuestionsResponse> => {
          const { body, set, request } = ctx;
          const parsedBody = body as {
            query?: string;
            datasets?: Array<{ filename: string; description?: string }>;
          };

          // Validate query
          const query = parsedBody.query;
          if (!query || typeof query !== "string" || query.trim().length === 0) {
            set.status = 400;
            return {
              error: "Missing required field: query",
              ok: false,
            };
          }

          // Extract optional datasets
          const datasets = parsedBody.datasets;

          // Get userId from auth context - require authentication
          const auth = request.auth;
          if (!auth?.userId) {
            set.status = 401;
            return { error: "Authentication required", ok: false };
          }

          const userId = auth.userId;

          logger.info(
            {
              datasetCount: datasets?.length || 0,
              queryLength: query.length,
              queryPreview: query.substring(0, 100),
              userId,
            },
            "clarification_generate_questions_request"
          );

          try {
            // Generate questions using the agent
            const result = await clarificationQuestionsAgent({ datasets, query });

            // Create session in database
            const session = await createClarificationSession({
              initialQuery: query,
              questions: result.questions,
              userId,
            });

            logger.info(
              {
                questionCount: result.questions.length,
                sessionId: session.id,
              },
              "clarification_session_created"
            );

            return {
              ok: true,
              questions: result.questions,
              reasoning: result.reasoning,
              sessionId: session.id,
            };
          } catch (error) {
            logger.error(
              { error, query: query.substring(0, 100), userId },
              "clarification_generate_questions_failed"
            );
            set.status = 500;
            return {
              error: error instanceof Error ? error.message : "Failed to generate questions",
              ok: false,
            };
          }
        }
      )

      // Submit answers and get generated plan
      .post("/api/clarification/submit-answers", async (ctx): Promise<SubmitAnswersResponse> => {
        const { body, set, request } = ctx;
        const parsedBody = body as {
          sessionId?: string;
          answers?: ClarificationAnswer[];
          datasets?: Array<{ filename: string; description?: string }>;
        };

        // Validate input
        const { sessionId, answers, datasets } = parsedBody;
        if (!sessionId || !answers || !Array.isArray(answers)) {
          set.status = 400;
          return {
            error: "Missing required fields: sessionId and answers",
            ok: false,
          };
        }

        // Get userId from auth context
        const auth = request.auth;
        if (!auth?.userId) {
          set.status = 401;
          return { error: "Authentication required", ok: false };
        }

        const userId = auth.userId;

        logger.info(
          {
            answerCount: answers.length,
            sessionId,
            userId,
          },
          "clarification_submit_answers_request"
        );

        try {
          // Get session and verify ownership
          const session = await getClarificationSessionForUser(sessionId, userId);
          if (!session) {
            set.status = 404;
            return {
              error: "Session not found or access denied",
              ok: false,
            };
          }

          // Validate session status
          if (session.status !== "questions_generated") {
            set.status = 400;
            return {
              error: `Cannot submit answers: session status is ${session.status}`,
              ok: false,
            };
          }

          // Submit answers to database
          await submitClarificationAnswers(sessionId, answers);

          // Generate plan using the agent
          const planResult = await clarificationPlanAgent({
            answers,
            datasets,
            query: session.initial_query,
            questions: session.questions,
          });

          // Save plan to database
          const updatedSession = await setClarificationPlan(sessionId, planResult.plan);

          logger.info(
            {
              sessionId,
              taskCount: planResult.plan.initialTasks.length,
            },
            "clarification_plan_generated"
          );

          return {
            ok: true,
            plan: planResult.plan,
            sessionId: updatedSession.id,
          };
        } catch (error) {
          logger.error({ error, sessionId, userId }, "clarification_submit_answers_failed");
          set.status = 500;
          return {
            error: error instanceof Error ? error.message : "Failed to submit answers",
            ok: false,
          };
        }
      })

      // Provide feedback on plan or approve it
      .post("/api/clarification/plan-feedback", async (ctx): Promise<PlanFeedbackResponse> => {
        const { body, set, request } = ctx;
        const parsedBody = body as {
          sessionId?: string;
          feedback?: string;
          approved?: boolean;
          datasets?: Array<{ filename: string; description?: string }>;
        };

        // Validate input
        const { sessionId, feedback, approved, datasets } = parsedBody;
        if (!sessionId || typeof approved !== "boolean") {
          set.status = 400;
          return {
            error: "Missing required fields: sessionId and approved",
            ok: false,
          };
        }

        // If not approving, feedback is required
        if (!approved && (!feedback || feedback.trim().length === 0)) {
          set.status = 400;
          return {
            error: "Feedback is required when not approving the plan",
            ok: false,
          };
        }

        // Get userId from auth context - require authentication
        const auth = request.auth;
        if (!auth?.userId) {
          set.status = 401;
          return { error: "Authentication required", ok: false };
        }

        const userId = auth.userId;

        logger.info(
          {
            approved,
            hasFeedback: !!feedback,
            sessionId,
            userId,
          },
          "clarification_plan_feedback_request"
        );

        try {
          // Get session and verify ownership
          const session = await getClarificationSessionForUser(sessionId, userId);
          if (!session) {
            set.status = 404;
            return {
              error: "Session not found or access denied",
              ok: false,
            };
          }

          // Validate session status
          if (session.status !== "plan_generated" && session.status !== "answers_submitted") {
            set.status = 400;
            return {
              error: `Cannot provide feedback: session status is ${session.status}`,
              ok: false,
            };
          }

          // Check that plan exists
          if (!session.plan) {
            set.status = 400;
            return {
              error: "No plan to provide feedback on",
              ok: false,
            };
          }

          if (approved) {
            // Approve the plan
            const updatedSession = await approveClarificationPlan(sessionId);

            logger.info({ sessionId }, "clarification_plan_approved");

            return {
              approved: true,
              ok: true,
              plan: updatedSession.plan!,
              sessionId: updatedSession.id,
            };
          } else {
            // Regenerate plan based on feedback
            const planResult = await clarificationPlanRegenerateAgent({
              answers: session.answers,
              datasets,
              feedback: feedback!,
              previousPlan: session.plan,
              query: session.initial_query,
              questions: session.questions,
            });

            // Add feedback entry and update plan
            const updatedSession = await addPlanFeedback({
              approved: false,
              feedback: feedback!,
              previousPlan: session.plan,
              regeneratedPlan: planResult.plan,
              sessionId,
            });

            logger.info(
              {
                sessionId,
                taskCount: planResult.plan.initialTasks.length,
              },
              "clarification_plan_regenerated"
            );

            return {
              approved: false,
              ok: true,
              plan: planResult.plan,
              sessionId: updatedSession.id,
            };
          }
        } catch (error) {
          logger.error({ error, sessionId, userId }, "clarification_plan_feedback_failed");
          set.status = 500;
          return {
            error: error instanceof Error ? error.message : "Failed to process feedback",
            ok: false,
          };
        }
      })

      // Get session state
      .get("/api/clarification/:sessionId", async (ctx): Promise<GetSessionResponse> => {
        const { params, set, request } = ctx;
        const { sessionId } = params;

        // Get userId from auth context - require authentication
        const auth = request.auth;
        if (!auth?.userId) {
          set.status = 401;
          return { error: "Authentication required", ok: false };
        }

        const userId = auth.userId;

        logger.info({ sessionId, userId }, "clarification_get_session_request");

        try {
          // Get session and verify ownership
          const session = await getClarificationSessionForUser(sessionId, userId);
          if (!session) {
            set.status = 404;
            return {
              error: "Session not found or access denied",
              ok: false,
            };
          }

          return {
            ok: true,
            session: {
              answers: session.answers,
              created_at: session.created_at,
              id: session.id,
              initial_query: session.initial_query,
              plan: session.plan,
              questions: session.questions,
              status: session.status,
              updated_at: session.updated_at,
            },
          };
        } catch (error) {
          logger.error({ error, sessionId, userId }, "clarification_get_session_failed");
          set.status = 500;
          return {
            error: error instanceof Error ? error.message : "Failed to get session",
            ok: false,
          };
        }
      })
);
