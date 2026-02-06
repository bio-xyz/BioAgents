// Database operations for demo sessions and messages

import { getSupabaseClient, getMainServerSupabaseClient } from "./supabase";
import type {
  DemoSession,
  DemoMessage,
  ResearchTopic,
  OrchestratorEvaluation,
  ConversationStateValues,
  SessionStatus,
} from "../services/orchestrator/types";
import logger from "../utils/logger";

// Helper to generate UUIDs
function generateUUID(): string {
  return crypto.randomUUID();
}

// ============ SESSIONS ============

export async function createSession(
  conversationId: string,
  topic: ResearchTopic
): Promise<DemoSession> {
  const supabase = getSupabaseClient();
  const now = new Date();
  const id = generateUUID();

  const sessionData = {
    id,
    conversation_id: conversationId,
    topic,
    status: "active" as SessionStatus,
    current_iteration: 0,
    orchestrator_decisions: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { data, error } = await supabase
    .from("demo_sessions")
    .insert(sessionData)
    .select()
    .single();

  if (error) {
    logger.error({ error, conversationId }, "Failed to create session");
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return mapDbSessionToSession(data);
}

export async function getSession(id: string): Promise<DemoSession | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("demo_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(`Failed to get session: ${error.message}`);
  }

  return mapDbSessionToSession(data);
}

export async function getActiveSessions(): Promise<DemoSession[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("demo_sessions")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get active sessions: ${error.message}`);
  }

  return (data || []).map(mapDbSessionToSession);
}

export async function getArchivedSessions(): Promise<DemoSession[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("demo_sessions")
    .select("*")
    .eq("status", "archived")
    .order("archived_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to get archived sessions: ${error.message}`);
  }

  return (data || []).map(mapDbSessionToSession);
}

export async function updateSession(
  id: string,
  updates: Partial<{
    status: SessionStatus;
    currentIteration: number;
    orchestratorDecisions: OrchestratorEvaluation[];
    finalState: ConversationStateValues;
    paperId: string;
    paperUrl: string;
    archivedAt: Date;
  }>
): Promise<DemoSession> {
  const supabase = getSupabaseClient();

  const dbUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.currentIteration !== undefined) dbUpdates.current_iteration = updates.currentIteration;
  if (updates.orchestratorDecisions !== undefined) dbUpdates.orchestrator_decisions = updates.orchestratorDecisions;
  if (updates.finalState !== undefined) dbUpdates.final_state = updates.finalState;
  if (updates.paperId !== undefined) dbUpdates.paper_id = updates.paperId;
  if (updates.paperUrl !== undefined) dbUpdates.paper_url = updates.paperUrl;
  if (updates.archivedAt !== undefined) dbUpdates.archived_at = updates.archivedAt.toISOString();

  const { data, error } = await supabase
    .from("demo_sessions")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update session: ${error.message}`);
  }

  return mapDbSessionToSession(data);
}

export async function deleteAllActiveSessions(): Promise<void> {
  const supabase = getSupabaseClient();

  // First delete messages for active sessions
  const { data: activeSessions } = await supabase
    .from("demo_sessions")
    .select("id")
    .eq("status", "active");

  if (activeSessions && activeSessions.length > 0) {
    const sessionIds = activeSessions.map((s) => s.id);

    await supabase
      .from("demo_messages")
      .delete()
      .in("session_id", sessionIds);

    await supabase
      .from("demo_sessions")
      .delete()
      .in("id", sessionIds);
  }
}

// ============ MESSAGES ============

export async function createMessage(
  sessionId: string,
  role: "orchestrator" | "main_server",
  content: string,
  messageId?: string,
  metadata?: Record<string, unknown>
): Promise<DemoMessage> {
  const supabase = getSupabaseClient();
  const id = generateUUID();
  const now = new Date();

  const messageData = {
    id,
    session_id: sessionId,
    role,
    content,
    message_id: messageId,
    metadata: metadata || {},
    created_at: now.toISOString(),
  };

  const { data, error } = await supabase
    .from("demo_messages")
    .insert(messageData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create message: ${error.message}`);
  }

  return mapDbMessageToMessage(data);
}

export async function getSessionMessages(sessionId: string): Promise<DemoMessage[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("demo_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get session messages: ${error.message}`);
  }

  return (data || []).map(mapDbMessageToMessage);
}

// ============ MAIN SERVER MESSAGES ============

/**
 * Get a message from the main server's messages table
 * Used to check if deep research has completed (response_time is set)
 */
export async function getMainServerMessage(messageId: string): Promise<{
  id: string;
  content: string | null;
  response_time: number | null;
  conversation_id: string;
} | null> {
  const supabase = getMainServerSupabaseClient();

  const { data, error } = await supabase
    .from("messages")
    .select("id, content, response_time, conversation_id")
    .eq("id", messageId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    logger.error({ error, messageId }, "Failed to get main server message");
    return null;
  }

  return data;
}

// ============ MAPPERS ============

function mapDbSessionToSession(data: any): DemoSession {
  return {
    id: data.id,
    conversationId: data.conversation_id,
    topic: data.topic,
    status: data.status,
    currentIteration: data.current_iteration,
    orchestratorDecisions: data.orchestrator_decisions || [],
    finalState: data.final_state,
    paperId: data.paper_id,
    paperUrl: data.paper_url,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    archivedAt: data.archived_at ? new Date(data.archived_at) : undefined,
  };
}

function mapDbMessageToMessage(data: any): DemoMessage {
  return {
    id: data.id,
    sessionId: data.session_id,
    role: data.role,
    content: data.content,
    messageId: data.message_id,
    metadata: data.metadata,
    createdAt: new Date(data.created_at),
  };
}
