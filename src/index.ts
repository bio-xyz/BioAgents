import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { chatRoute } from "./routes/chat";
import { authRoute } from "./routes/auth";
import { x402Middleware } from "./middleware/x402";
import { x402Route } from "./routes/x402";
import logger from "./utils/logger";

const app = new Elysia()
  // Enable CORS for frontend access
  .use(cors({
    origin: true, // Allow all origins (Coolify handles domain routing)
    credentials: true, // Important: allow cookies
  }))

  // Apply x402 payment gating (only active when enabled via config)
  .use(x402Middleware())

  // Basic request logging (optional)
  .onRequest(({ request }) => {
    if (!logger) return;
    logger.info(
      { method: request.method, url: request.url },
      "incoming_request",
    );
  })
  .onError(({ code, error }) => {
    if (!logger) return;
    logger.error({ code, err: error }, "unhandled_error");
  })

  // Mount auth routes (no protection needed for auth endpoints)
  .use(authRoute)
  .use(x402Route)

  // Note: We always serve UI files regardless of auth status
  // The frontend (useAuth hook) will check /api/auth/status and show login screen if needed
  // This allows the login UI to render properly

  // Serve the Preact UI (from client/dist)
  .get("/", () => {
    return Bun.file("client/dist/index.html");
  })

  // Serve the bundled Preact app JS file
  .get("/index.js", () => {
    return new Response(Bun.file("client/dist/index.js"), {
      headers: {
        "Content-Type": "application/javascript",
      },
    });
  })

  // Serve the bundled CSS file
  .get("/index.css", () => {
    return new Response(Bun.file("client/dist/index.css"), {
      headers: {
        "Content-Type": "text/css",
      },
    });
  })

  // Serve source map for debugging
  .get("/index.js.map", () => {
    return new Response(Bun.file("client/dist/index.js.map"), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  })

  // Handle favicon (prevent 404 errors)
  .get("/favicon.ico", () => {
    return new Response(null, { status: 204 });
  })

  // Debug endpoint
  .get("/api/health", () => {
    if (logger) logger.info("Health check endpoint hit");
    return { status: "ok", timestamp: new Date().toISOString() };
  })

  // API routes (not protected by UI auth)
  .use(chatRoute);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const hostname = process.env.HOST || "0.0.0.0"; // Bind to all interfaces for Docker/Coolify

app.listen({
  port,
  hostname,
}, () => {
  if (logger)
    logger.info({ url: `http://${hostname}:${port}` }, "server_listening");
  else console.log(`Server listening on http://${hostname}:${port}`);
});
