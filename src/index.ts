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
import logger from "./utils/logger";

const app = new Elysia()
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
  .use(chatRoute) // GET and POST /api/chat for agent-based chat
  .use(deepResearchStartRoute) // GET and POST /api/deep-research/start for deep research
  .use(deepResearchStatusRoute) // GET /api/deep-research/status/:messageId to check status
  .use(artifactsRoute) // GET /api/artifacts/download for artifact downloads

  // x402 payment routes (payment auth instead of API key)
  .use(x402Route) // GET /api/x402/* for config, pricing, payments, health
  .use(x402ChatRoute) // POST /api/x402/chat for payment-gated chat
  .use(x402DeepResearchRoute) // POST /api/x402/deep-research/start, GET /api/x402/deep-research/status/:messageId

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

// Log startup configuration
const isProduction = process.env.NODE_ENV === "production";
const hasSecret = !!process.env.BIOAGENTS_SECRET;

app.listen(
  {
    port,
    hostname,
  },
  () => {
    if (logger) {
      logger.info({ url: `http://${hostname}:${port}` }, "server_listening");
      logger.info(
        {
          nodeEnv: process.env.NODE_ENV || "development",
          isProduction,
          authRequired: isProduction,
          secretConfigured: hasSecret,
        },
        "auth_configuration",
      );
    } else {
      console.log(`Server listening on http://${hostname}:${port}`);
      console.log(
        `Auth config: NODE_ENV=${process.env.NODE_ENV}, production=${isProduction}, secretConfigured=${hasSecret}`,
      );
    }
  },
);
