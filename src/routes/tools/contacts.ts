import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";

const BIO_LIT_URL = () => process.env.BIO_LIT_AGENT_API_URL;
const BIO_LIT_KEY = () => process.env.BIO_LIT_AGENT_API_KEY;

export const contactsRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true }), rateLimitMiddleware("tools")] },
  (app) =>
    app.get("/api/tools/target/contacts", async ({ query, set }) => {
      if (!BIO_LIT_URL()) {
        set.status = 503;
        return { error: "Target service not configured" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const url = new URL(`${BIO_LIT_URL()}/tools/target/contacts`);
        for (const [k, v] of Object.entries(query as Record<string, string>)) {
          if (v !== undefined) url.searchParams.set(k, v);
        }
        const res = await fetch(url.toString(), {
          headers: { "X-API-Key": BIO_LIT_KEY() ?? "" },
          signal: controller.signal,
        });
        set.status = res.status;
        return await res.json();
      } catch {
        set.status = 502;
        return { error: "Target contacts upstream error" };
      } finally {
        clearTimeout(timeout);
      }
    })
);
