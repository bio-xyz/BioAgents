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
import { getOrCreateUserByWallet } from "../db/operations";
import { authResolver } from "../middleware/authResolver";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import type { AuthContext } from "../types/auth";
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
              ok: false,
              error: "Missing required field: query",
            };
          }

          // Extract optional datasets
          const datasets = parsedBody.datasets;

          // Get userId from auth context - require authentication
          const auth = (request as any).auth as AuthContext | undefined;
          if (!auth?.userId && !(auth?.method === "x402" && auth?.externalId)) {
            set.status = 401;
            return { ok: false, error: "Authentication required" };
          }

          let userId = auth.userId!;

          // For x402 users, ensure wallet user record exists
          if (auth?.method === "x402" && auth?.externalId) {
            const { user } = await getOrCreateUserByWallet(auth.externalId);
            userId = user.id;
          }

          logger.info(
            {
              userId,
              queryLength: query.length,
              queryPreview: query.substring(0, 100),
              datasetCount: datasets?.length || 0,
            },
            "clarification_generate_questions_request",
          );

          try {
            // Generate questions using the agent
            const result = await clarificationQuestionsAgent({ query, datasets });

            // Create session in database
            const session = await createClarificationSession({
              userId,
              initialQuery: query,
              questions: result.questions,
            });

            logger.info(
              {
                sessionId: session.id,
                questionCount: result.questions.length,
              },
              "clarification_session_created",
            );

            return {
              ok: true,
              sessionId: session.id,
              questions: result.questions,
              reasoning: result.reasoning,
            };
          } catch (error) {
            logger.error(
              { error, userId, query: query.substring(0, 100) },
              "clarification_generate_questions_failed",
            );
            set.status = 500;
            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to generate questions",
            };
          }
        },
      )

      // Submit answers and get generated plan
      .post(
        "/api/clarification/submit-answers",
        async (ctx): Promise<SubmitAnswersResponse> => {
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
              ok: false,
              error: "Missing required fields: sessionId and answers",
            };
          }

          // Get userId from auth context
          const auth = (request as any).auth as AuthContext | undefined;
          if (!auth?.userId && !(auth?.method === "x402" && auth?.externalId)) {
            set.status = 401;
            return { ok: false, error: "Authentication required" };
          }

          let userId = auth.userId!;

          if (auth?.method === "x402" && auth?.externalId) {
            const { user } = await getOrCreateUserByWallet(auth.externalId);
            userId = user.id;
          }

          logger.info(
            {
              userId,
              sessionId,
              answerCount: answers.length,
            },
            "clarification_submit_answers_request",
          );

          try {
            // Get session and verify ownership
            const session = await getClarificationSessionForUser(
              sessionId,
              userId,
            );
            if (!session) {
              set.status = 404;
              return {
                ok: false,
                error: "Session not found or access denied",
              };
            }

            // Validate session status
            if (session.status !== "questions_generated") {
              set.status = 400;
              return {
                ok: false,
                error: `Cannot submit answers: session status is ${session.status}`,
              };
            }

            // Submit answers to database
            await submitClarificationAnswers(sessionId, answers);

            // Generate plan using the agent
            const planResult = await clarificationPlanAgent({
              query: session.initial_query,
              questions: session.questions,
              answers,
              datasets,
            });

            // Save plan to database
            const updatedSession = await setClarificationPlan(
              sessionId,
              planResult.plan,
            );

            logger.info(
              {
                sessionId,
                taskCount: planResult.plan.initialTasks.length,
              },
              "clarification_plan_generated",
            );

            return {
              ok: true,
              sessionId: updatedSession.id,
              plan: planResult.plan,
            };
          } catch (error) {
            logger.error(
              { error, userId, sessionId },
              "clarification_submit_answers_failed",
            );
            set.status = 500;
            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to submit answers",
            };
          }
        },
      )

      // Provide feedback on plan or approve it
      .post(
        "/api/clarification/plan-feedback",
        async (ctx): Promise<PlanFeedbackResponse> => {
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
              ok: false,
              error: "Missing required fields: sessionId and approved",
            };
          }

          // If not approving, feedback is required
          if (!approved && (!feedback || feedback.trim().length === 0)) {
            set.status = 400;
            return {
              ok: false,
              error: "Feedback is required when not approving the plan",
            };
          }

          // Get userId from auth context - require authentication
          const auth = (request as any).auth as AuthContext | undefined;
          if (!auth?.userId && !(auth?.method === "x402" && auth?.externalId)) {
            set.status = 401;
            return { ok: false, error: "Authentication required" };
          }

          let userId = auth.userId!;

          if (auth?.method === "x402" && auth?.externalId) {
            const { user } = await getOrCreateUserByWallet(auth.externalId);
            userId = user.id;
          }

          logger.info(
            {
              userId,
              sessionId,
              approved,
              hasFeedback: !!feedback,
            },
            "clarification_plan_feedback_request",
          );

          try {
            // Get session and verify ownership
            const session = await getClarificationSessionForUser(
              sessionId,
              userId,
            );
            if (!session) {
              set.status = 404;
              return {
                ok: false,
                error: "Session not found or access denied",
              };
            }

            // Validate session status
            if (
              session.status !== "plan_generated" &&
              session.status !== "answers_submitted"
            ) {
              set.status = 400;
              return {
                ok: false,
                error: `Cannot provide feedback: session status is ${session.status}`,
              };
            }

            // Check that plan exists
            if (!session.plan) {
              set.status = 400;
              return {
                ok: false,
                error: "No plan to provide feedback on",
              };
            }

            if (approved) {
              // Approve the plan
              const updatedSession = await approveClarificationPlan(sessionId);

              logger.info(
                { sessionId },
                "clarification_plan_approved",
              );

              return {
                ok: true,
                sessionId: updatedSession.id,
                plan: updatedSession.plan!,
                approved: true,
              };
            } else {
              // Regenerate plan based on feedback
              const planResult = await clarificationPlanRegenerateAgent({
                query: session.initial_query,
                questions: session.questions,
                answers: session.answers,
                previousPlan: session.plan,
                feedback: feedback!,
                datasets,
              });

              // Add feedback entry and update plan
              const updatedSession = await addPlanFeedback({
                sessionId,
                feedback: feedback!,
                previousPlan: session.plan,
                regeneratedPlan: planResult.plan,
                approved: false,
              });

              logger.info(
                {
                  sessionId,
                  taskCount: planResult.plan.initialTasks.length,
                },
                "clarification_plan_regenerated",
              );

              return {
                ok: true,
                sessionId: updatedSession.id,
                plan: planResult.plan,
                approved: false,
              };
            }
          } catch (error) {
            logger.error(
              { error, userId, sessionId },
              "clarification_plan_feedback_failed",
            );
            set.status = 500;
            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to process feedback",
            };
          }
        },
      )

      // Get session state
      .get(
        "/api/clarification/:sessionId",
        async (ctx): Promise<GetSessionResponse> => {
          const { params, set, request } = ctx;
          const { sessionId } = params;

          // Get userId from auth context - require authentication
          const auth = (request as any).auth as AuthContext | undefined;
          if (!auth?.userId && !(auth?.method === "x402" && auth?.externalId)) {
            set.status = 401;
            return { ok: false, error: "Authentication required" };
          }

          let userId = auth.userId!;

          if (auth?.method === "x402" && auth?.externalId) {
            const { user } = await getOrCreateUserByWallet(auth.externalId);
            userId = user.id;
          }

          logger.info(
            { userId, sessionId },
            "clarification_get_session_request",
          );

          try {
            // Get session and verify ownership
            const session = await getClarificationSessionForUser(
              sessionId,
              userId,
            );
            if (!session) {
              set.status = 404;
              return {
                ok: false,
                error: "Session not found or access denied",
              };
            }

            return {
              ok: true,
              session: {
                id: session.id,
                status: session.status,
                initial_query: session.initial_query,
                questions: session.questions,
                answers: session.answers,
                plan: session.plan,
                created_at: session.created_at,
                updated_at: session.updated_at,
              },
            };
          } catch (error) {
            logger.error(
              { error, userId, sessionId },
              "clarification_get_session_failed",
            );
            set.status = 500;
            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to get session",
            };
          }
        },
      ),
);
