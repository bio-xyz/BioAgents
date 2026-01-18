/**
 * Centralized Supabase Client Module
 *
 * This module provides a single source for Supabase clients used throughout
 * the backend. The service client uses the service role key to bypass RLS,
 * which is appropriate for backend services where authentication is already
 * verified by the auth middleware.
 *
 * IMPORTANT: The service role key should NEVER be exposed to client-side code.
 * All API routes using this client must verify authentication first via authResolver.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import logger from "../utils/logger";

// Singleton instances
let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

/**
 * Get the Supabase service client (bypasses RLS)
 *
 * This client uses the service role key and bypasses all RLS policies.
 * Use this for backend operations where authentication has already been
 * verified by the auth middleware (authResolver).
 *
 * @returns Supabase client with service role permissions
 * @throws Error if SUPABASE_URL or SUPABASE_SERVICE_KEY is not configured
 */
export function getServiceClient(): SupabaseClient {
  if (serviceClient) {
    return serviceClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is not configured");
  }

  if (!serviceKey) {
    // Fall back to anon key with a warning if service key is not available
    // This allows the system to work in development without RLS
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error(
        "Neither SUPABASE_SERVICE_KEY nor SUPABASE_ANON_KEY environment variable is configured"
      );
    }

    logger.warn(
      "SUPABASE_SERVICE_KEY not configured, falling back to SUPABASE_ANON_KEY. " +
        "This may cause RLS policy failures in production."
    );

    serviceClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    return serviceClient;
  }

  serviceClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  logger.info("Supabase service client initialized with service role key");

  return serviceClient;
}

/**
 * Get the Supabase anonymous client (respects RLS)
 *
 * This client uses the anonymous key and respects all RLS policies.
 * Use this for operations that should be subject to RLS, typically
 * when you want to pass through user context.
 *
 * @returns Supabase client with anonymous permissions
 * @throws Error if SUPABASE_URL or SUPABASE_ANON_KEY is not configured
 */
export function getAnonClient(): SupabaseClient {
  if (anonClient) {
    return anonClient;
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL environment variable is not configured");
  }

  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY environment variable is not configured");
  }

  anonClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return anonClient;
}

/**
 * Get the default Supabase client
 *
 * Alias for getServiceClient() - returns the service client for backend use.
 * This is the recommended client for all backend database operations.
 *
 * @returns Supabase client with service role permissions
 */
export function getSupabaseClient(): SupabaseClient {
  return getServiceClient();
}

/**
 * Reset client instances (useful for testing)
 */
export function resetClients(): void {
  serviceClient = null;
  anonClient = null;
}

// Default export for convenience - returns service client
export default getServiceClient;
