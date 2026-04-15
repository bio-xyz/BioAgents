import type { AnalysisArtifact, PlanTask } from "../types/core";
import logger from "../utils/logger";
import { getServiceClient } from "./client";

// Use service client to bypass RLS - auth is verified by middleware
const supabase = getServiceClient();

export interface User {
  id?: string;
  username: string;
  email: string;
  used_invite_code?: string;
  points?: number;
  has_completed_invite_flow?: boolean;
  invite_codes_remaining?: number;
}

export interface Conversation {
  id?: string;
  user_id: string;
  conversation_state_id?: string;
}

export interface State {
  id?: string;
  values: any;
  created_at?: string;
  updated_at?: string;
}

export interface ConversationState {
  id?: string;
  values: any;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id?: string;
  conversation_id: string;
  user_id: string;
  question?: string;
  content: string;
  summary?: string; // Optional summary for agent messages
  state_id?: string;
  response_time?: number;
  source?: string;
  files?: any; // JSONB field for file metadata
}

// User operations
export async function getUser(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    logger.error(`[getUser] Error getting user: ${error.message}`);
    throw error;
  } // PGRST116 = not found
  return data;
}

export async function createUser(userData: User) {
  const { data, error } = await supabase
    .from("users")
    .upsert(userData, { onConflict: "id", ignoreDuplicates: true })
    .select()
    .single();

  if (error) {
    // PGRST116 = not found (can happen with ignoreDuplicates when no row returned)
    // 23505 = duplicate key (shouldn't happen with upsert but handle gracefully)
    if (error.code === "PGRST116" || error.code === "23505") {
      // User already exists, return null (caller should handle)
      return null;
    }
    logger.error(`[createUser] Error creating user: ${error.message}`);
    throw error;
  }
  return data;
}

// Conversation operations
export async function createConversation(conversationData: Conversation) {
  const { data, error } = await supabase
    .from("conversations")
    .insert(conversationData)
    .select()
    .single();

  if (error) {
    logger.error(
      `[createConversation] Error creating conversation: ${error.message}`,
    );
    throw error;
  }
  return data;
}

// Message operations
export async function createMessage(messageData: Message) {
  const { data, error } = await supabase
    .from("messages")
    .insert(messageData)
    .select()
    .single();

  if (error) {
    logger.error(`[createMessage] Error creating message: ${error.message}`);
    throw error;
  }
  return data;
}

export async function updateMessage(id: string, updates: Partial<Message>) {
  const { data, error } = await supabase
    .from("messages")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logger.error(`[updateMessage] Error updating message: ${error.message}`);
    throw error;
  }
  return data;
}

export async function getMessage(id: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*, state:states(*)")
    .eq("id", id)
    .single();

  if (error) {
    logger.error(`[getMessage] Error getting message: ${error.message}`);
    throw error;
  }
  return data;
}

export async function getMessagesByConversation(
  conversationId: string,
  limit?: number,
) {
  let query = supabase
    .from("messages")
    .select("*, state:states(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    logger.error(
      `[getMessagesByConversation] Error getting messages by conversation: ${error.message}`,
    );
    throw error;
  }
  return data;
}

// State operations
export async function createState(stateData: { values: any }) {
  const { data, error } = await supabase
    .from("states")
    .insert(stateData)
    .select()
    .single();

  if (error) {
    logger.error(`[createState] Error creating state: ${error.message}`);
    throw error;
  }
  return data;
}

/**
 * Update state in DB
 * Automatically strips file buffers and parsedText to prevent Supabase timeout
 * These large fields are kept in memory for processing but not persisted
 */
export async function updateState(id: string, values: any) {
  const cleanedValues = cleanValues(values);

  const { data, error } = await supabase
    .from("states")
    .update({ values: cleanedValues })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logger.error(`[updateState] Error updating state: ${error.message}`);
    throw error;
  }
  return data;
}

export async function getState(id: string) {
  const { data, error } = await supabase
    .from("states")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    logger.error(`[getState] Error getting state: ${error.message}`);
    throw error;
  }
  return data;
}

// ConversationState operations
export async function createConversationState(stateData: { values: any }) {
  const { data, error } = await supabase
    .from("conversation_states")
    .insert(stateData)
    .select()
    .single();

  if (error) {
    logger.error(
      `[createConversationState] Error creating conversation state: ${error.message}`,
    );
    throw error;
  }
  return data;
}

export async function updateConversationState(
  id: string,
  values: any,
  options?: { preserveUploadedDatasets?: boolean },
) {
  const { preserveUploadedDatasets = true } = options || {};

  let finalValues = { ...values };

  // IMPORTANT: By default, always preserve uploadedDatasets from the database
  // This prevents race conditions where chat/deep-research workers
  // overwrite files added by file-process workers running concurrently
  if (preserveUploadedDatasets) {
    const currentState = await getConversationState(id);
    const currentUploadedDatasets = currentState?.values?.uploadedDatasets;
    if (currentUploadedDatasets !== undefined) {
      finalValues.uploadedDatasets = currentUploadedDatasets;
    }
  }

  const cleanedValues = cleanValues(finalValues);
  const { data, error } = await supabase
    .from("conversation_states")
    .update({ values: cleanedValues })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logger.error(
      `[updateConversationState] Error updating conversation state: ${error.message}`,
    );
    throw error;
  }
  return data;
}

export async function getConversationState(id: string) {
  const { data, error } = await supabase
    .from("conversation_states")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    logger.error(
      `[getConversationState] Error getting conversation state: ${error.message}`,
    );
    throw error;
  }
  return data;
}

// Get conversation by ID
export async function getConversation(id: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    logger.error(
      `[getConversation] Error getting conversation: ${error.message}`,
    );
    throw error;
  }
  return data;
}

// Get all conversations for a user
export async function getUserConversations(userId: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, conversation_state_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error(
      `[getUserConversations] Error getting user conversations: ${error.message}`,
    );
    throw error;
  }
  return data || [];
}

// Update conversation to link conversation_state_id
export async function updateConversation(
  id: string,
  updates: Partial<Conversation>,
) {
  const { data, error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logger.error(
      `[updateConversation] Error updating conversation: ${error.message}`,
    );
    throw error;
  }
  return data;
}

// Helper to clean large fields from state values before persisting
function cleanValues(values: any): any {
  const cleanedValues = { ...values };

  // Strip buffers and parsedText from rawFiles if present
  if (cleanedValues.rawFiles?.length) {
    cleanedValues.rawFiles = cleanedValues.rawFiles.map((f: any) => ({
      ...f,
      buffer: undefined,
      parsedText: undefined,
    }));
  }

  // Strip binary buffers from datasets if present, but PRESERVE content (text)
  // Content is the parsed text we want to pass to the LLM
  if (cleanedValues.uploadedDatasets?.length) {
    cleanedValues.uploadedDatasets = cleanedValues.uploadedDatasets.map(
      (d: any) => ({
        ...d,
        buffer: undefined, // Strip binary buffer, but keep content (text)
      }),
    );
  }

  // Strip buffers from plan datasets if present
  if (cleanedValues.plan?.length) {
    cleanedValues.plan = cleanedValues.plan.map((task: PlanTask) => {
      if (task.datasets?.length) {
        const cleanedDatasets = task.datasets.map((d: any) => ({
          ...d,
          content: undefined,
        }));
        return { ...task, datasets: cleanedDatasets };
      }
      return task;
    });
  }

  // Strip content from plan artifacts if present
  if (cleanedValues.plan?.length) {
    cleanedValues.plan = cleanedValues.plan.map((task: PlanTask) => {
      if (task.artifacts?.length) {
        const cleanedArtifacts = task.artifacts.map((a: AnalysisArtifact) => ({
          ...a,
          content: undefined,
        }));
        return { ...task, artifacts: cleanedArtifacts };
      }
      return task;
    });
  }

  return cleanedValues;
}

// ============================================================================
// Token Usage Operations
// ============================================================================

export type TokenUsageType = "chat" | "deep-research" | "paper-generation";

export interface TokenUsage {
  id?: string;
  message_id?: string; // Nullable: set for chat/deep-research
  paper_id?: string; // Nullable: set for paper-generation
  type: TokenUsageType;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms?: number;
  created_at?: string;
}

/**
 * Create a token usage record
 * Either message_id or paper_id must be provided
 */
export async function createTokenUsage(
  tokenUsage: Omit<TokenUsage, "id" | "created_at">
): Promise<TokenUsage> {
  // Validate that at least one reference is provided
  if (!tokenUsage.message_id && !tokenUsage.paper_id) {
    throw new Error("Either message_id or paper_id must be provided");
  }

  const { data, error } = await supabase
    .from("token_usage")
    .insert(tokenUsage)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}
