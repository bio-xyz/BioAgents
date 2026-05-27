import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import logger from "../../utils/logger";

// Proxies AlphaFold structure assets (CIF/PDB/PAE) so the frontend avoids CORS issues.
export const alphafoldProxyRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true })] },
  (app) =>
    app.get("/api/tools/alphafold/proxy", async ({ query, set }) => {
      const { url } = query as { url?: string };

      if (!url) {
        set.status = 400;
        return { error: "Missing url parameter" };
      }

      // Only allow AlphaFold EBI URLs to prevent open proxy abuse
      if (!url.startsWith("https://alphafold.ebi.ac.uk/")) {
        set.status = 400;
        return { error: "Only AlphaFold EBI URLs are allowed" };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "BIOS-Platform/1.0 (https://ai.bio.xyz)" },
          signal: controller.signal,
        });

        if (!res.ok) {
          set.status = res.status === 404 ? 404 : 502;
          return { error: `AlphaFold returned ${res.status}` };
        }

        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        const buffer = await res.arrayBuffer();
        set.headers["Content-Type"] = contentType;
        set.headers["Cache-Control"] = "public, max-age=86400";
        return new Uint8Array(buffer);
      } catch (err) {
        logger.error({ err, url }, "alphafold_proxy_fetch_failed");
        set.status = 502;
        return { error: "Failed to fetch AlphaFold asset" };
      } finally {
        clearTimeout(timeout);
      }
    })
);
