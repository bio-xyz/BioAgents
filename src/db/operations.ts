import { createClient } from "@supabase/supabase-js";
import type { AnalysisArtifact, PlanTask } from "../types/core";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

export interface User {
  id?: string;
  username: string;
  email: string;
  wallet_address?: string; // For x402 payment users identified by wallet
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

/**
 * Get user by wallet address (for x402 users)
 */
export async function getUserByWallet(walletAddress: string) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
  return data;
}

/**
 * Get or create user by wallet address (for x402 users)
 * Returns existing user or creates a new one with wallet as identity
 */
export async function getOrCreateUserByWallet(walletAddress: string): Promise<{
  user: any;
  isNew: boolean;
}> {
  const normalizedWallet = walletAddress.toLowerCase();

  // Try to find existing user
  const existingUser = await getUserByWallet(normalizedWallet);
  if (existingUser) {
    return { user: existingUser, isNew: false };
  }

  // Create new user with wallet identity
  const shortWallet = normalizedWallet.slice(0, 10);
  const newUser = await createUser({
    username: `wallet_${shortWallet}`,
    email: `${normalizedWallet}@x402.local`,
    wallet_address: normalizedWallet,
  });

  return { user: newUser, isNew: true };
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

export async function getMessage(id: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*, state:states(*)")
    .eq("id", id)
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

// ConversationState operations
export async function createConversationState(stateData: { values: any }) {
  const { data, error } = await supabase
    .from("conversation_states")
    .insert(stateData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateConversationState(id: string, values: any) {
  const cleanedValues = cleanValues(values);
  const { data, error } = await supabase
    .from("conversation_states")
    .update({ values: cleanedValues })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getConversationState(id: string) {
  const { data, error } = await supabase
    .from("conversation_states")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Get conversation by ID
export async function getConversation(id: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
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

  if (error) throw error;
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

  // Strip buffers from datasets if present
  if (cleanedValues.uploadedDatasets?.length) {
    cleanedValues.uploadedDatasets = cleanedValues.uploadedDatasets.map(
      (d: any) => ({
        ...d,
        content: undefined,
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
