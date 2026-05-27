import { Elysia } from "elysia";
import { authResolver } from "../../middleware/authResolver";
import logger from "../../utils/logger";

// Proxies PDB/CIF files from RCSB so the frontend avoids CORS issues.
export const pdbProxyRoute = new Elysia().guard(
  { beforeHandle: [authResolver({ required: true })] },
  (app) =>
    app.get("/api/tools/pdb-proxy", async ({ query, set }) => {
      const { pdbId } = query as { pdbId?: string };

      if (!pdbId || !/^[A-Za-z0-9]{4}$/.test(pdbId)) {
        set.status = 400;
        return { error: "Invalid PDB ID" };
      }

      const id = pdbId.toUpperCase();
      const url = `https://files.rcsb.org/download/${id}.pdb`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "BIOS-Platform/1.0 (https://ai.bio.xyz)" },
          signal: controller.signal,
        });

        if (!res.ok) {
          set.status = res.status === 404 ? 404 : 502;
          return { error: `RCSB returned ${res.status}` };
        }

        const text = await res.text();
        set.headers["Content-Type"] = "text/plain";
        set.headers["Cache-Control"] = "public, max-age=86400";
        return text;
      } catch (err) {
        logger.error({ err, pdbId: id }, "pdb_proxy_fetch_failed");
        set.status = 502;
        return { error: "Failed to fetch PDB file" };
      } finally {
        clearTimeout(timeout);
      }
    })
);
