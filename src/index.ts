import { Elysia } from "elysia";
import { chatRoute } from "./routes/chat";
import logger from "./utils/logger";

const app = new Elysia()
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
  .use(chatRoute);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  if (logger)
    logger.info({ url: `http://localhost:${port}` }, "server_listening");
  else console.log(`Server listening on http://localhost:${port}`);
});
