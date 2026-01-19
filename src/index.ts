// Must be first - polyfills for pdf-parse/pdfjs-dist
import "./utils/canvas-polyfill";

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { artifactsRoute } from "./routes/artifacts";
import { authRoute } from "./routes/auth";
import { chatRoute } from "./routes/chat";
import { deepResearchStartRoute } from "./routes/deep-research/start";
import { deepResearchStatusRoute } from "./routes/deep-research/status";
import { deepResearchPaperRoute } from "./routes/deep-research/paper";
import { filesRoute } from "./routes/files";
import { x402Route } from "./routes/x402";
import { x402ChatRoute } from "./routes/x402/chat";
import { x402DeepResearchRoute } from "./routes/x402/deep-research";
import { b402Route } from "./routes/b402";
import { b402ChatRoute } from "./routes/b402/chat";
import { b402DeepResearchRoute } from "./routes/b402/deep-research";
import logger from "./utils/logger";

// BullMQ Queue imports (conditional)
import { isJobQueueEnabled, closeConnections } from "./services/queue/connection";
import { websocketHandler, cleanupDeadConnections } from "./services/websocket/handler";
import { startRedisSubscription, stopRedisSubscription } from "./services/websocket/subscribe";
import { createQueueDashboard } from "./routes/admin/queue-dashboard";
import { adminJobsRoute } from "./routes/admin/jobs";

// ============================================================================
// CORS Configuration - Security Critical
// ============================================================================
// Set ALLOWED_ORIGINS env var in production: comma-separated list of allowed origins
// Example: ALLOWED_ORIGINS=https://bioagent-platform.bioagents.dev,https://app.bioagents.xyz
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

const ALLOWED_ORIGINS: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

// Log CORS configuration on startup
if (process.env.NODE_ENV === "production" && !process.env.ALLOWED_ORIGINS) {
  logger.warn(
    { defaultOrigins: DEFAULT_ALLOWED_ORIGINS },
    "cors_security_warning: ALLOWED_ORIGINS not set in production - using localhost defaults only. Set ALLOWED_ORIGINS env var for production domains."
  );
} else {
  logger.info({ allowedOrigins: ALLOWED_ORIGINS }, "cors_configuration");
}

/**
 * CORS origin validator
 * - Allows same-origin requests (no Origin header)
 * - Allows requests from whitelisted origins
 * - Rejects and logs requests from unknown origins
 */
function validateCorsOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  // Allow requests with no origin (same-origin, curl, server-to-server)
  if (!origin) {
    return true;
  }

  // Check against whitelist
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  // Log rejected origin for security monitoring
  logger.warn({ origin, allowedOrigins: ALLOWED_ORIGINS }, "cors_origin_rejected");
  return false;
}

const app = new Elysia()
  // WebSocket handler for real-time notifications (when job queue enabled)
  .use(websocketHandler)
  // Enable CORS with origin whitelist
  .use(
    cors({
      origin: validateCorsOrigin,
      credentials: true,
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
      maxAge: 86400, // Cache preflight for 24 hours
    }),
  )

  // ============================================================================
  // Security Headers
  // ============================================================================
  .onBeforeHandle(({ set }) => {
    // Prevent MIME-type sniffing attacks
    set.headers["X-Content-Type-Options"] = "nosniff";

    // Prevent clickjacking (iframe embedding)
    set.headers["X-Frame-Options"] = "DENY";

    // Enable browser XSS filter (legacy browsers)
    set.headers["X-XSS-Protection"] = "1; mode=block";

    // Control referrer information leakage
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

    // Disable unnecessary browser features
    set.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";

    // Force HTTPS in production (only enable if you have valid SSL)
    if (process.env.NODE_ENV === "production") {
      set.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
  })

  // Basic request logging
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
        const { getBullMQConnection } = await import("./services/queue/connection");
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
  .use(deepResearchPaperRoute) // POST /api/deep-research/conversations/:conversationId/paper for paper generation
  .use(artifactsRoute) // GET /api/artifacts/download for artifact downloads
  .use(filesRoute) // POST /api/files/* for direct S3 file uploads

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
  // Add basic auth protection for admin routes if ADMIN_PASSWORD is set
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (ADMIN_PASSWORD) {
    app.onBeforeHandle(({ request, set }) => {
      const url = new URL(request.url);
      
      // Only protect /admin/* routes
      if (!url.pathname.startsWith("/admin")) {
        return;
      }

      const authHeader = request.headers.get("Authorization");
      
      // Check for valid basic auth
      if (!authHeader || !authHeader.startsWith("Basic ")) {
        set.status = 401;
        set.headers["WWW-Authenticate"] = 'Basic realm="Admin Dashboard"';
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const base64Credentials = authHeader.slice(6);
        const credentials = atob(base64Credentials);
        const [username, password] = credentials.split(":");

        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
          logger.warn({ path: url.pathname }, "admin_dashboard_invalid_credentials");
          set.status = 401;
          set.headers["WWW-Authenticate"] = 'Basic realm="Admin Dashboard"';
          return new Response("Unauthorized", { status: 401 });
        }
      } catch {
        set.status = 401;
        set.headers["WWW-Authenticate"] = 'Basic realm="Admin Dashboard"';
        return new Response("Unauthorized", { status: 401 });
      }
    });
    logger.info({ path: "/admin/queues", authEnabled: true }, "bull_board_dashboard_mounted_with_auth");
  } else {
    logger.info({ path: "/admin/queues", authEnabled: false }, "bull_board_dashboard_mounted_no_auth");
  }

  app.use(queueDashboard);
}

// Mount admin jobs API (for frontend dashboard)
app.use(adminJobsRoute);

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
