import { getServiceClient } from "./client";

// Use service client to bypass RLS - auth is verified by middleware
const supabase = getServiceClient();

export interface X402PaymentRecord {
  id?: string;
  user_id?: string;
  conversation_id?: string;
  message_id?: string;
  amount_usd: number;
  amount_wei: string;
  asset: string;
  network: string;
  tools_used?: string[];
  tx_hash?: string;
  network_id?: string;
  payment_status: "pending" | "verified" | "settled" | "failed";
  payment_header?: Record<string, unknown> | null;
  payment_requirements?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
  verified_at?: string;
  settled_at?: string;
}

export async function createPayment(
  payment: X402PaymentRecord,
): Promise<X402PaymentRecord> {
  const { data, error } = await supabase
    .from("x402_payments")
    .insert(payment)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePayment(
  id: string,
  updates: Partial<X402PaymentRecord>,
): Promise<X402PaymentRecord> {
  const { data, error } = await supabase
    .from("x402_payments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPaymentsByUser(
  userId: string,
  limit?: number,
): Promise<X402PaymentRecord[]> {
  let query = supabase
    .from("x402_payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getUserPaymentStats(userId: string) {
  const { data, error } = await supabase
    .from("user_payment_stats")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// X402 External Requests Operations (for external API consumers)
// ============================================================================

export interface X402ExternalRecord {
  id?: string;
  conversation_id: string; // UUID of conversation in conversations table
  request_path: string;
  tx_hash?: string;
  amount_usd?: number;
  amount_wei?: string;
  asset?: string;
  network?: string;
  network_id?: string;
  payment_status?: "pending" | "verified" | "settled" | "failed";
  payment_header?: Record<string, unknown> | null;
  payment_requirements?: Record<string, unknown> | null;
  request_metadata?: Record<string, unknown>; // stores providedUserId, fileInfo, etc.
  response_time?: number;
  error_message?: string;
  created_at?: string;
}

export async function createX402External(
  record: X402ExternalRecord,
): Promise<X402ExternalRecord> {
  const { data, error } = await supabase
    .from("x402_external")
    .insert(record)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateX402External(
  id: string,
  updates: Partial<X402ExternalRecord>,
): Promise<X402ExternalRecord> {
  const { data, error } = await supabase
    .from("x402_external")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getX402ExternalByConversationId(
  conversationId: string,
  limit?: number,
): Promise<X402ExternalRecord[]> {
  let query = supabase
    .from("x402_external")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

