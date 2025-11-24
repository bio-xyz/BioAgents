import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { x402Hook } from "./middleware/x402";
import { x402Config } from "./x402/config";
import { authRoute } from "./routes/auth";
import { chatRoute, chatRouteGet } from "./routes/chat";
import {
  deepResearchStartGet,
  deepResearchStartRoute,
} from "./routes/deep-research/start";
import { deepResearchStatusRoute } from "./routes/deep-research/status";
import { x402Route } from "./routes/x402";
import { x402ChatRoute } from "./routes/x402/chat";
import { x402ResearchRoute } from "./routes/x402/research";
import { x402ResearchStatusRoute } from "./routes/x402/status";
import logger from "./utils/logger";

const app = new Elysia()
  // Enable CORS for frontend access + x402 headers
  .use(
    cors({
      origin: true, // Allow all origins (Coolify handles domain routing)
      credentials: true, // Important: allow cookies
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-PAYMENT",
        "X-Requested-With",
      ],
      exposeHeaders: ["X-PAYMENT-RESPONSE", "Content-Type"],
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
  .use(x402Route)

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

  // Debug endpoint
  .get("/api/health", () => {
    if (logger) logger.info("Health check endpoint hit");
    return { status: "ok", timestamp: new Date().toISOString() };
  })

  // Suppress Chrome DevTools 404 error
  .get("/.well-known/appspecific/com.chrome.devtools.json", () => {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  })

  // API routes (not protected by UI auth)
  .use(chatRouteGet) // GET /api/chat for x402scan discovery
  .use(chatRoute) // POST /api/chat for actual chat
  .use(deepResearchStartGet) // GET /api/deep-research/start for x402scan discovery
  .use(deepResearchStartRoute) // POST /api/deep-research/start to start deep research
  .use(deepResearchStatusRoute) // GET /api/deep-research/status/:messageId to check status

  // Separated x402 routes (dedicated endpoints for x402 consumers)
  // Use .guard() to apply x402Hook to these routes (ensures hook propagation)
  .guard(
    x402Config.enabled ? { beforeHandle: x402Hook } : {},
    (app) => {
      if (logger) {
        logger.info(
          { x402Enabled: x402Config.enabled },
          "x402_guard_applied_to_routes"
        );
      }
      return app
        .use(x402ChatRoute) // GET and POST /api/x402/chat for x402 chat
        .use(x402ResearchRoute) // GET and POST /api/x402/research for x402 deep research
        .use(x402ResearchStatusRoute); // GET /api/x402/research/status/:messageId to check status
    }
  )

  // Catch-all route for SPA client-side routing
  // This handles routes like /chat, /settings, etc. and serves the main UI
  // The client-side router will handle the actual routing
  .get("*", async () => {
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

app.listen(
  {
    port,
    hostname,
  },
  () => {
    if (logger)
      logger.info({ url: `http://${hostname}:${port}` }, "server_listening");
    else console.log(`Server listening on http://${hostname}:${port}`);
  },
);
