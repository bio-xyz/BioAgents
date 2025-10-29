import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

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

