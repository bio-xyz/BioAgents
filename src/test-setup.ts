/**
 * Test Setup - Preloaded before all test files
 *
 * Sets required environment variables to dummy values so that module-level
 * initializations (like Supabase client creation) don't crash during unit tests.
 *
 * These are placeholder values — no actual external service calls are made.
 *
 * Referenced in bunfig.toml:
 *   [test]
 *   preload = ["./src/test-setup.ts"]
 */

// Database — prevents Supabase client initialization errors
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "test-anon-key-for-unit-tests";

// Authentication — required for JWT/poll token signing
process.env.BIOAGENTS_SECRET =
  process.env.BIOAGENTS_SECRET || "test-secret-for-unit-tests";
