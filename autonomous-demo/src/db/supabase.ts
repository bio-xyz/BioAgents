// Supabase client initialization
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../utils/config";

let supabaseClient: SupabaseClient | null = null;
let mainServerSupabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase URL and anon key are required");
    }

    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

/**
 * Get Supabase client for the main server's database
 * Used to query messages table to check deep research completion
 */
export function getMainServerSupabaseClient(): SupabaseClient {
  if (!mainServerSupabaseClient) {
    const url = config.mainServerSupabaseUrl;
    const key = config.mainServerSupabaseAnonKey;

    if (!url || !key) {
      throw new Error("Main server Supabase URL and anon key are required");
    }

    mainServerSupabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
  }

  return mainServerSupabaseClient;
}
