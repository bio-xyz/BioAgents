// Must be first - polyfills for pdf-parse/pdfjs-dist
import "./utils/canvas-polyfill";

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { artifactsRoute } from "./routes/artifacts";
import { authRoute } from "./routes/auth";
import { chatRoute } from "./routes/chat";
import { deepResearchStartRoute } from "./routes/deep-research/start";
import { deepResearchStatusRoute } from "./routes/deep-research/status";
import { x402Route } from "./routes/x402";
import { x402ChatRoute } from "./routes/x402/chat";
import { x402DeepResearchRoute } from "./routes/x402/deep-research";
import { b402Route } from "./routes/b402";
import { b402ChatRoute } from "./routes/b402/chat";
import { b402DeepResearchRoute } from "./routes/b402/deep-research";
import logger from "./utils/logger";

// BullMQ Queue imports (conditional)
import { isJobQueueEnabled, closeConnections } from "./queue/connection";
import { websocketHandler, cleanupDeadConnections } from "./websocket/handler";
import { startRedisSubscription, stopRedisSubscription } from "./websocket/subscribe";
import { createQueueDashboard } from "./routes/admin/queue-dashboard";

const app = new Elysia()
  // WebSocket handler for real-time notifications (when job queue enabled)
  .use(websocketHandler)
  // Enable CORS for frontend access
  .use(
    cors({
      origin: true, // Allow all origins (Coolify handles domain routing)
      credentials: true, // Important: allow cookies
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Requested-With",
        "X-PAYMENT", // x402 payment proof header
      ],
      exposeHeaders: [
        "Content-Type",
        "X-PAYMENT-RESPONSE", // x402 settlement response header
      ],
    }),
  )

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

  // Note: We always serve UI files regardless of auth status
  // The frontend (useAuth hook) will check /api/auth/status and show login screen if needed
  // This allows the login UI to render properly

  // Serve the Preact UI (from client/dist) with SEO metadata injection
  .get("/", async () => {
    const htmlFile = Bun.file("client/dist/index.html");
    let htmlContent = await htmlFile.text();

    // Inject SEO metadata from environment variables
    const seoTitle = process.env.SEO_TITLE || "BioAgents Chat";
    const seoDescription =
      process.env.SEO_DESCRIPTION || "AI-powered chat interface";
    const faviconUrl = process.env.FAVICON_URL || "/favicon.ico";
    const ogImageUrl =
      process.env.OG_IMAGE_URL || "https://bioagents.xyz/og-image.png";

    htmlContent = htmlContent
      .replace(/\{\{SEO_TITLE\}\}/g, seoTitle)
      .replace(/\{\{SEO_DESCRIPTION\}\}/g, seoDescription)
      .replace(/\{\{FAVICON_URL\}\}/g, faviconUrl)
      .replace(/\{\{OG_IMAGE_URL\}\}/g, ogImageUrl);

    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html",
      },
    });
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

  // Health check endpoint with optional queue/Redis status
  .get("/api/health", async () => {
    if (logger) logger.info("Health check endpoint hit");

    const health: {
      status: string;
      timestamp: string;
      jobQueue?: {
        enabled: boolean;
        redis?: string;
      };
    } = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };

    // Add job queue status if enabled
    if (isJobQueueEnabled()) {
      try {
        const { getBullMQConnection } = await import("./queue/connection");
        const redis = getBullMQConnection();
        await redis.ping();
        health.jobQueue = {
          enabled: true,
          redis: "connected",
        };
      } catch (error) {
        health.jobQueue = {
          enabled: true,
          redis: "disconnected",
        };
        health.status = "degraded";
      }
    } else {
      health.jobQueue = {
        enabled: false,
      };
    }

    return health;
  })

  // Suppress Chrome DevTools 404 error
  .get("/.well-known/appspecific/com.chrome.devtools.json", () => {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  })

  // API routes (not protected by UI auth)
  .use(chatRoute) // GET and POST /api/chat for agent-based chat
  .use(deepResearchStartRoute) // GET and POST /api/deep-research/start for deep research
  .use(deepResearchStatusRoute) // GET /api/deep-research/status/:messageId to check status
  .use(artifactsRoute) // GET /api/artifacts/download for artifact downloads

  // x402 payment routes - Base Sepolia (USDC)
  .use(x402Route) // GET /api/x402/* for config, pricing, payments, health
  .use(x402ChatRoute) // POST /api/x402/chat for payment-gated chat
  .use(x402DeepResearchRoute) // POST /api/x402/deep-research/start, GET /api/x402/deep-research/status/:messageId

  // b402 payment routes - BNB Chain (USDT)
  .use(b402Route) // GET /api/b402/* for config, pricing, health
  .use(b402ChatRoute) // POST /api/b402/chat for payment-gated chat
  .use(b402DeepResearchRoute); // POST /api/b402/deep-research/start, GET /api/b402/deep-research/status/:messageId

// Mount Bull Board dashboard (only when job queue is enabled)
const queueDashboard = createQueueDashboard();
if (queueDashboard) {
  app.use(queueDashboard);
  logger.info({ path: "/admin/queues" }, "bull_board_dashboard_mounted");
}

// Continue with catch-all route
app
  // Catch-all route for SPA client-side routing
  // This handles routes like /chat, /settings, etc. and serves the main UI
  // The client-side router will handle the actual routing
  // Excludes /api/* and /admin/* paths
  .get("*", async ({ request }) => {
    const url = new URL(request.url);

    // Don't intercept /admin/* routes (Bull Board)
    if (url.pathname.startsWith("/admin")) {
      return new Response("Not Found", { status: 404 });
    }

    const htmlFile = Bun.file("client/dist/index.html");
    let htmlContent = await htmlFile.text();

    // Inject SEO metadata from environment variables
    const seoTitle = process.env.SEO_TITLE || "BioAgents Chat";
    const seoDescription =
      process.env.SEO_DESCRIPTION || "AI-powered chat interface";
    const faviconUrl = process.env.FAVICON_URL || "/favicon.ico";
    const ogImageUrl =
      process.env.OG_IMAGE_URL || "https://bioagents.xyz/og-image.png";

    htmlContent = htmlContent
      .replace(/\{\{SEO_TITLE\}\}/g, seoTitle)
      .replace(/\{\{SEO_DESCRIPTION\}\}/g, seoDescription)
      .replace(/\{\{FAVICON_URL\}\}/g, faviconUrl)
      .replace(/\{\{OG_IMAGE_URL\}\}/g, ogImageUrl);

    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  });

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const hostname = process.env.HOST || "0.0.0.0"; // Bind to all interfaces for Docker/Coolify

// Log startup configuration
const isProduction = process.env.NODE_ENV === "production";
const hasSecret = !!process.env.BIOAGENTS_SECRET;

app.listen(
  {
    port,
    hostname,
  },
  async () => {
    if (logger) {
      logger.info({ url: `http://${hostname}:${port}` }, "server_listening");
      logger.info(
        {
          nodeEnv: process.env.NODE_ENV || "development",
          isProduction,
          authRequired: isProduction,
          secretConfigured: hasSecret,
          jobQueueEnabled: isJobQueueEnabled(),
        },
        "auth_configuration",
      );
    } else {
      console.log(`Server listening on http://${hostname}:${port}`);
      console.log(
        `Auth config: NODE_ENV=${process.env.NODE_ENV}, production=${isProduction}, secretConfigured=${hasSecret}`,
      );
      console.log(`Job queue: ${isJobQueueEnabled() ? "enabled" : "disabled"}`);
    }

    // Start Redis subscription for WebSocket notifications if job queue is enabled
    if (isJobQueueEnabled()) {
      try {
        await startRedisSubscription();
        if (logger) {
          logger.info("websocket_redis_subscription_started");
        } else {
          console.log("WebSocket Redis subscription started");
        }
      } catch (error) {
        if (logger) {
          logger.error({ error }, "websocket_redis_subscription_failed");
        } else {
          console.error("Failed to start WebSocket Redis subscription:", error);
        }
      }

      // Periodic cleanup of dead WebSocket connections (every 30 seconds)
      setInterval(() => {
        cleanupDeadConnections();
      }, 30000);
    }
  },
);

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  if (logger) {
    logger.info({ signal }, "graceful_shutdown_initiated");
  } else {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
  }

  try {
    // Stop Redis subscription
    if (isJobQueueEnabled()) {
      await stopRedisSubscription();
      await closeConnections();
      if (logger) {
        logger.info("redis_connections_closed");
      } else {
        console.log("Redis connections closed");
      }
    }

    process.exit(0);
  } catch (error) {
    if (logger) {
      logger.error({ error }, "graceful_shutdown_error");
    } else {
      console.error("Error during shutdown:", error);
    }
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
