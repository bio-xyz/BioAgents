import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";
import logger from "../../utils/logger";

const BIO_LIT_URL = () => process.env.BIO_LIT_AGENT_API_URL;
const BIO_LIT_KEY = () => process.env.BIO_LIT_AGENT_API_KEY;

export const targetRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true }), rateLimitMiddleware("tools")] },
  (app) =>
    app.post("/api/tools/target", async ({ body, set }) => {
      const bioLitUrl = BIO_LIT_URL();
      const bioLitKey = BIO_LIT_KEY();
      if (!bioLitUrl || !bioLitKey) {
        set.status = 503;
        return { error: "Target service not configured" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(`${bioLitUrl}/tools/target`, {
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": bioLitKey,
          },
          method: "POST",
          signal: controller.signal,
        });
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        logger.error({ err }, "target_proxy_fetch_failed");
        set.status = isAbort ? 504 : 502;
        return { error: isAbort ? "Target request timed out" : "Target upstream error" };
      } finally {
        clearTimeout(timeout);
      }
      set.status = res.status;
      try {
        return await res.json();
      } catch {
        return { error: `Target returned ${res.status}` };
      }
    })
);
