import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";

const BIO_LIT_URL = () => process.env.BIO_LIT_AGENT_API_URL;
const BIO_LIT_KEY = () => process.env.BIO_LIT_AGENT_API_KEY;

export const targetRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true }), rateLimitMiddleware("tools")] },
  (app) =>
    app.post("/api/tools/target", async ({ body, set }) => {
      if (!BIO_LIT_URL()) {
        set.status = 503;
        return { error: "Target service not configured" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const res = await fetch(`${BIO_LIT_URL()}/tools/target`, {
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": BIO_LIT_KEY() ?? "",
          },
          method: "POST",
          signal: controller.signal,
        });
        set.status = res.status;
        return await res.json();
      } catch {
        set.status = 502;
        return { error: "Target pipeline upstream error" };
      } finally {
        clearTimeout(timeout);
      }
    })
);
