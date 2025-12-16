import { createClient } from "@supabase/supabase-js";

// These are injected at build time via Bun.build's define option
// They come from the .env file: SUPABASE_URL and SUPABASE_ANON_KEY
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables. Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set in .env file.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Types matching backend schema
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
  created_at?: string;
}

export interface Message {
  id?: string;
  conversation_id: string;
  user_id: string;
  question?: string;
  content: string;
  summary?: string; // Optional summary for agent messages
  state?: any;
  response_time?: number;
  source?: string;
  created_at?: string;
  files?: any; // JSONB field for file metadata
}

// Client-side database operations
export async function getConversationsByUser(userId: string) {
  console.log("[supabase] Fetching conversations for user_id:", userId);
  
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[supabase] Error fetching conversations:", error);
    throw error;
  }
  
  console.log("[supabase] Found conversations for userId:", data?.length || 0);
  return data;
}

export async function getMessagesByConversation(
  conversationId: string,
  limit?: number
) {
  console.log("[supabase] Fetching messages for conversation_id:", conversationId);
  
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }); // Ascending for chat display

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[supabase] Error fetching messages:", error);
    throw error;
  }
  
  console.log("[supabase] Found messages:", data?.length || 0);
  return data;
}

export async function createConversation(conversationData: Conversation) {
  const { data, error } = await supabase
    .from("conversations")
    .insert(conversationData)
    .select()
    .single();

  if (error) {
    // Ignore duplicate errors (code 23505)
    if (error.code === "23505") {
      return conversationData;
    }
    throw error;
  }
  return data;
}

export async function createMessage(messageData: Message) {
  const { data, error } = await supabase
    .from("messages")
    .insert(messageData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getStatesByConversation(conversationId: string) {
  const { data, error } = await supabase
    .from("states")
    .select("*")
    .eq("values->>conversationId", conversationId)
    .order("created_at", { ascending: true }); // Get all states in chronological order

  if (error) throw error;
  return data;
}

/**
 * Get the conversation state (persistent research state) for a conversation
 * This contains the hypothesis, insights, datasets, suggested next steps, etc.
 */
export async function getConversationState(conversationId: string) {
  // First get the conversation to find the conversation_state_id
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("conversation_state_id")
    .eq("id", conversationId)
    .single();

  if (convError) {
    // If conversation not found, return null (not an error)
    if (convError.code === "PGRST116") return null;
    throw convError;
  }

  if (!conversation?.conversation_state_id) {
    return null;
  }

  // Fetch the conversation state
  const { data, error } = await supabase
    .from("conversation_states")
    .select("*")
    .eq("id", conversation.conversation_state_id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data;
}
