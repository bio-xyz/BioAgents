/**
 * Clarification Session Database Operations
 *
 * Database operations for the pre-research clarification flow.
 * Uses the service client pattern from operations.ts.
 */

import type {
  ClarificationAnswer,
  ClarificationPlan,
  ClarificationQuestion,
  ClarificationSession,
  ClarificationStatus,
  PlanFeedbackEntry,
} from "../types/clarification";
import logger from "../utils/logger";
import { getServiceClient } from "./client";

// Use service client to bypass RLS - auth is verified by middleware
const supabase = getServiceClient();

/**
 * Create a new clarification session with generated questions
 */
export async function createClarificationSession(input: {
  userId: string;
  initialQuery: string;
  questions: ClarificationQuestion[];
}): Promise<ClarificationSession> {
  const { userId, initialQuery, questions } = input;

  const { data, error } = await supabase
    .from("clarification_sessions")
    .insert({
      user_id: userId,
      initial_query: initialQuery,
      questions: questions,
      status: "questions_generated" as ClarificationStatus,
    })
    .select()
    .single();

  if (error) {
    logger.error(
      { error, userId },
      "[createClarificationSession] Error creating clarification session",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Get a clarification session by ID
 */
export async function getClarificationSession(
  sessionId: string,
): Promise<ClarificationSession | null> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // Not found
      return null;
    }
    logger.error(
      { error, sessionId },
      "[getClarificationSession] Error getting clarification session",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Get a clarification session by ID and verify user ownership
 */
export async function getClarificationSessionForUser(
  sessionId: string,
  userId: string,
): Promise<ClarificationSession | null> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // Not found
      return null;
    }
    logger.error(
      { error, sessionId, userId },
      "[getClarificationSessionForUser] Error getting clarification session",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Submit answers to a clarification session and update status
 */
export async function submitClarificationAnswers(
  sessionId: string,
  answers: ClarificationAnswer[],
): Promise<ClarificationSession> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      answers: answers,
      status: "answers_submitted" as ClarificationStatus,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId },
      "[submitClarificationAnswers] Error submitting answers",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Set the generated plan for a clarification session
 */
export async function setClarificationPlan(
  sessionId: string,
  plan: ClarificationPlan,
): Promise<ClarificationSession> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      plan: plan,
      status: "plan_generated" as ClarificationStatus,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId },
      "[setClarificationPlan] Error setting plan",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Add feedback to a clarification session's plan
 * If approved=true, also updates status to plan_approved
 */
export async function addPlanFeedback(input: {
  sessionId: string;
  feedback: string;
  previousPlan: ClarificationPlan;
  regeneratedPlan?: ClarificationPlan;
  approved: boolean;
}): Promise<ClarificationSession> {
  const { sessionId, feedback, previousPlan, regeneratedPlan, approved } =
    input;

  // First get the current session to append to plan_feedback
  const session = await getClarificationSession(sessionId);
  if (!session) {
    throw new Error(`Clarification session not found: ${sessionId}`);
  }

  const newFeedbackEntry: PlanFeedbackEntry = {
    feedback,
    previousPlan,
    regeneratedPlan,
    timestamp: new Date().toISOString(),
    approved,
  };

  const updatedFeedback = [...(session.plan_feedback || []), newFeedbackEntry];

  // Determine new status and plan
  const newStatus: ClarificationStatus = approved
    ? "plan_approved"
    : "plan_generated";
  const newPlan = regeneratedPlan || session.plan;

  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      plan_feedback: updatedFeedback,
      plan: newPlan,
      status: newStatus,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId },
      "[addPlanFeedback] Error adding plan feedback",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Approve the current plan for a clarification session
 */
export async function approveClarificationPlan(
  sessionId: string,
): Promise<ClarificationSession> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      status: "plan_approved" as ClarificationStatus,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId },
      "[approveClarificationPlan] Error approving plan",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Link a clarification session to a conversation
 * Called when deep research starts with an approved plan
 */
export async function linkSessionToConversation(
  sessionId: string,
  conversationId: string,
): Promise<ClarificationSession> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      conversation_id: conversationId,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId, conversationId },
      "[linkSessionToConversation] Error linking session to conversation",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Abandon a clarification session (e.g., user starts over)
 */
export async function abandonClarificationSession(
  sessionId: string,
): Promise<ClarificationSession> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .update({
      status: "abandoned" as ClarificationStatus,
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    logger.error(
      { error, sessionId },
      "[abandonClarificationSession] Error abandoning session",
    );
    throw error;
  }

  return data as ClarificationSession;
}

/**
 * Get recent clarification sessions for a user
 */
export async function getUserClarificationSessions(
  userId: string,
  limit: number = 10,
): Promise<ClarificationSession[]> {
  const { data, error } = await supabase
    .from("clarification_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(
      { error, userId },
      "[getUserClarificationSessions] Error getting user sessions",
    );
    throw error;
  }

  return (data || []) as ClarificationSession[];
}
