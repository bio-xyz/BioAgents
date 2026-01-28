/**
 * Utilities for semi-autonomous continuation mode in deep research
 *
 * Handles:
 * - Finding original user question when continuing (empty message.question)
 * - Session level tracking for reply context
 * - Continuation message creation
 */

import { getMessagesByConversation, createMessage } from "../../db/operations";
import type { Message } from "../../types/core";
import logger from "../logger";

export type ConversationHistoryEntry = {
  question?: string;
  summary?: string;
  content?: string;
};

/**
 * Fetch recent conversation history for context
 * Used by reply agent to handle continuation messages ("continue", "yes", etc.)
 */
export async function fetchConversationHistory(
  conversationId: string,
  limit: number = 4,
): Promise<ConversationHistoryEntry[]> {
  try {
    const allMessages = await getMessagesByConversation(conversationId, limit);
    if (!allMessages || allMessages.length <= 1) return [];

    // Skip current message, take previous ones, reverse to chronological order
    return allMessages
      .slice(1, limit)
      .reverse()
      .map((msg) => ({
        question: msg.question,
        summary: msg.summary,
        content: msg.content,
      }));
  } catch (err) {
    logger.warn({ err }, "failed_to_fetch_conversation_history");
    return [];
  }
}

/**
 * Resolve the question to use for reply generation
 * Priority: current message question > first question from history > objective fallback
 *
 * This handles semi-autonomous continuation where message.question is empty
 */
export function resolveQuestionForReply(
  messageQuestion: string | undefined,
  conversationHistory: ConversationHistoryEntry[],
  objectiveFallback?: string,
): string {
  // 1. Use current message question if present
  if (messageQuestion) return messageQuestion;

  // 2. Find original question from conversation history
  if (conversationHistory.length > 0) {
    const originalQuestion = conversationHistory.find(
      (h) => h.question,
    )?.question;
    if (originalQuestion) return originalQuestion;
  }

  // 3. Fall back to objective
  return objectiveFallback || "";
}

/**
 * Create agent continuation message for next iteration
 * Used when auto-continuing research without user input
 */
export async function createContinuationMessage(
  currentMessage: Message,
  stateId: string,
): Promise<Message> {
  return createMessage({
    conversation_id: currentMessage.conversation_id,
    user_id: currentMessage.user_id,
    question: "", // Empty = agent-initiated continuation
    content: "", // Filled by next iteration's reply
    source: currentMessage.source,
    state_id: stateId,
  });
}

/**
 * Calculate session start level for tracking tasks across continuations
 * Returns the current level (or 0 if undefined) - tasks at this level and above will be included
 */
export function calculateSessionStartLevel(
  currentLevel: number | undefined,
): number {
  return currentLevel ?? 0;
}

/**
 * Get completed tasks from session (last N levels)
 * Used to gather all work done across autonomous continuations for reply
 */
export function getSessionCompletedTasks<
  T extends { level?: number; output?: string },
>(
  plan: T[],
  sessionStartLevel: number,
  currentLevel: number,
  maxLevels: number = 3,
): T[] {
  const minLevel = Math.max(sessionStartLevel, currentLevel - (maxLevels - 1));
  return plan.filter(
    (t) => (t.level ?? 0) >= minLevel && t.output && t.output.length > 0,
  );
}
