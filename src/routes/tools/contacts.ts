import { Elysia, t } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import { rateLimitMiddleware } from "../../middleware/rateLimiter";
import logger from "../../utils/logger";

const BIO_LIT_URL = () => process.env.BIO_LIT_AGENT_API_URL?.replace(/\/$/, "");
const BIO_LIT_KEY = () => process.env.BIO_LIT_AGENT_API_KEY;

export const contactsRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true }), rateLimitMiddleware("tools")] },
  (app) =>
    app.get(
      "/api/tools/target/contacts",
      async ({ query, set }) => {
        const bioLitUrl = BIO_LIT_URL();
        const bioLitKey = BIO_LIT_KEY();
        if (!bioLitUrl || !bioLitKey) {
          set.status = 503;
          return { error: "Target service not configured" };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        const url = new URL(`${bioLitUrl}/tools/target/contacts`);
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
        let res: Response;
        try {
          res = await fetch(url.toString(), {
            headers: { "X-API-Key": bioLitKey },
            signal: controller.signal,
          });
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          logger.error({ err }, "contacts_proxy_fetch_failed");
          set.status = isAbort ? 504 : 502;
          return {
            error: isAbort ? "Contacts request timed out" : "Target contacts upstream error",
          };
        } finally {
          clearTimeout(timeout);
        }

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          logger.error(
            { bodyText: bodyText.slice(0, 400), status: res.status },
            "contacts_proxy_upstream_error"
          );
          if (res.status >= 500) {
            set.status = 502;
            return { error: "Target contacts upstream error" };
          }
          set.status = res.status;
          try {
            return JSON.parse(bodyText) as unknown;
          } catch {
            return { error: bodyText || `Contacts error (${res.status})` };
          }
        }

        try {
          return await res.json();
        } catch {
          logger.error({ status: res.status }, "contacts_proxy_non_json_2xx");
          set.status = 502;
          return { error: "Target contacts returned non-JSON response" };
        }
      },
      {
        query: t.Object({
          distance: t.Optional(t.String()),
          ligand_chain: t.Optional(t.String()),
          pdb_id: t.String({ maxLength: 4, minLength: 4, pattern: "^[A-Za-z0-9]{4}$" }),
          receptor_chain: t.Optional(t.String()),
        }),
      }
    )
);
