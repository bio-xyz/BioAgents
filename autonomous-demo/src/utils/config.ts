// Configuration loaded from environment variables
// Uses getters so values are read at access time, not import time

export const config = {
  // Server
  get port() {
    return parseInt(process.env.DEMO_PORT || "3001", 10);
  },
  get mainServerUrl() {
    return process.env.MAIN_SERVER_URL || "http://localhost:3000";
  },

  // Anthropic
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  get orchestratorModel() {
    return process.env.ORCHESTRATOR_MODEL || "claude-opus-4-5-20251101";
  },

  // Supabase (demo persistence)
  get supabaseUrl() {
    return process.env.SUPABASE_URL || "";
  },
  get supabaseAnonKey() {
    return process.env.SUPABASE_ANON_KEY || "";
  },

  // Main Server Supabase (for querying messages)
  get mainServerSupabaseUrl() {
    return process.env.MAIN_SERVER_SUPABASE_URL || "";
  },
  get mainServerSupabaseAnonKey() {
    return process.env.MAIN_SERVER_SUPABASE_ANON_KEY || "";
  },

  // Research config
  get minIterations() {
    return parseInt(process.env.MIN_ITERATIONS || "3", 10);
  },
  get maxIterations() {
    return parseInt(process.env.MAX_ITERATIONS || "15", 10);
  },
  get pollIntervalMs() {
    return parseInt(process.env.POLL_INTERVAL_MS || "3000", 10);
  },
  get maxPollAttempts() {
    return parseInt(process.env.MAX_POLL_ATTEMPTS || "120", 10);
  },
};

export function validateConfig(): void {
  const required = [
    ["ANTHROPIC_API_KEY", config.anthropicApiKey],
    ["SUPABASE_URL", config.supabaseUrl],
    ["SUPABASE_ANON_KEY", config.supabaseAnonKey],
  ] as const;

  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
