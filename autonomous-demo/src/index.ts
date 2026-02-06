// Autonomous Research Demo - Main Entry Point

// Load .env FIRST using sync require before any ES imports
import { readFileSync } from "fs";
import { join } from "path";

const envPath = join(import.meta.dir, "../.env");
try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        process.env[key] = value;
      }
    }
  }
  console.log(`[env] Loaded DEMO_PORT=${process.env.DEMO_PORT}`);
} catch (e) {
  console.log(`[env] No .env found, using defaults`);
}

// NOW do the dynamic imports after env is loaded
const { Elysia } = await import("elysia");
const { config, validateConfig } = await import("./utils/config");
const logger = (await import("./utils/logger")).default;
const { apiRoutes } = await import("./routes/api");
const { initialize, startOrchestratorLoop } = await import("./services/orchestrator");

// Validate configuration
try {
  validateConfig();
} catch (error) {
  console.error("Configuration validation failed:", error);
  process.exit(1);
}

// HARDCODE port to 3001 to avoid any env issues
const PORT = 3001;
// Unset PORT env to prevent Elysia from picking up parent's PORT=3000
delete process.env.PORT;

// Paths need to be absolute
const clientDistPath = join(import.meta.dir, "../client/dist");

// Helper to serve static files
const serveStatic = async (filename: string, contentType: string, set: any) => {
  const filePath = join(clientDistPath, filename);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    set.headers["content-type"] = contentType;
    return file;
  }
  set.status = 404;
  return "Not found";
};

console.log(`[DEBUG] About to start Elysia on port ${PORT}, process.env.PORT=${process.env.PORT}`);

// Create Elysia app
const app = new Elysia()
  // Serve static files manually
  .get("/index.js", ({ set }) => serveStatic("index.js", "application/javascript", set))
  .get("/styles.css", ({ set }) => serveStatic("styles.css", "text/css", set))
  // API routes
  .use(apiRoutes)
  // SPA fallback - serve index.html for all other routes
  .get("*", async ({ set }) => {
    const file = Bun.file(join(clientDistPath, "index.html"));
    if (await file.exists()) {
      set.headers["content-type"] = "text/html";
      return file;
    }
    return "Client not built. Run: bun run build:client";
  })
  .listen(PORT);

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           AUTONOMOUS RESEARCH DEMO                             ║
╠════════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:${String(PORT).padEnd(38)}║
║  Main API:   ${config.mainServerUrl.padEnd(49)}║
║  Model:      ${config.orchestratorModel.padEnd(49)}║
╚════════════════════════════════════════════════════════════════╝
`);

// Initialize and start orchestrator
try {
  logger.info("Initializing orchestrator...");
  await initialize();
  logger.info("Starting orchestrator loop...");
  startOrchestratorLoop();
} catch (error) {
  logger.error({ error }, "Failed to start orchestrator");
}

// Note: Do NOT export default app - Bun auto-serves exported defaults on port 3000
