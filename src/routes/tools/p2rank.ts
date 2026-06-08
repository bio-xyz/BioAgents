import { Elysia, t } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";
import logger from "../../utils/logger";

const BIO_LIT_URL = () => process.env.BIO_LIT_AGENT_API_URL?.replace(/\/$/, "");
const BIO_LIT_KEY = () => process.env.BIO_LIT_AGENT_API_KEY;

export const p2rankRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true }), rateLimitMiddleware("tools")] },
  (app) =>
    app.post(
      "/api/tools/target/p2rank",
      async ({ body, set }) => {
        const bioLitUrl = BIO_LIT_URL();
        const bioLitKey = BIO_LIT_KEY();
        if (!bioLitUrl || !bioLitKey) {
          set.status = 503;
          return { error: "P2Rank service not configured" };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);
        let res: Response;
        try {
          res = await fetch(`${bioLitUrl}/tools/target/p2rank`, {
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
          logger.error({ err }, "p2rank_proxy_fetch_failed");
          set.status = isAbort ? 504 : 502;
          return { error: isAbort ? "P2Rank request timed out" : "P2Rank upstream error" };
        } finally {
          clearTimeout(timeout);
        }

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          logger.error(
            { bodyText: bodyText.slice(0, 400), status: res.status },
            "p2rank_proxy_upstream_error"
          );
          if (res.status >= 500) {
            set.status = 502;
            return { error: "P2Rank upstream error" };
          }
          set.status = res.status;
          try {
            return JSON.parse(bodyText) as unknown;
          } catch {
            return { error: bodyText || `P2Rank error (${res.status})` };
          }
        }

        try {
          return await res.json();
        } catch {
          logger.error({ status: res.status }, "p2rank_proxy_non_json_2xx");
          set.status = 502;
          return { error: "P2Rank returned non-JSON response" };
        }
      },
      {
        body: t.Object({
          pdb_id: t.String({ maxLength: 4, minLength: 4, pattern: "^[A-Za-z0-9]{4}$" }),
        }),
      }
    )
);
