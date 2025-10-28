import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

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
}

export interface State {
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
  state_id?: string;
  response_time?: number;
  source?: string;
  files?: any; // JSONB field for file metadata
}

// User operations
export async function createUser(userData: User) {
  const { data, error } = await supabase
    .from("users")
    .insert(userData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Conversation operations
export async function createConversation(conversationData: Conversation) {
  const { data, error } = await supabase
    .from("conversations")
    .insert(conversationData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Message operations
export async function createMessage(messageData: Message) {
  const { data, error } = await supabase
    .from("messages")
    .insert(messageData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateMessage(id: string, updates: Partial<Message>) {
  const { data, error } = await supabase
    .from("messages")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
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

  if (error) throw error;
  return data;
}

// State operations
export async function createState(stateData: { values: any }) {
  const { data, error } = await supabase
    .from("states")
    .insert(stateData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateState(id: string, values: any) {
  const { data, error } = await supabase
    .from("states")
    .update({ values })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getState(id: string) {
  const { data, error } = await supabase
    .from("states")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
