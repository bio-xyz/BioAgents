import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { chatRoute } from "./routes/chat";
import logger from "./utils/logger";

const app = new Elysia()
  // Enable CORS for frontend access
  .use(cors())

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
  .use(chatRoute);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  if (logger)
    logger.info({ url: `http://localhost:${port}` }, "server_listening");
  else console.log(`Server listening on http://localhost:${port}`);
});
