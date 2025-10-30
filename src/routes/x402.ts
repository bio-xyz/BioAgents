import { Elysia } from "elysia";
import { x402Config } from "../x402/config";
import { routePricing, toolPricing } from "../x402/pricing";
import {
  getPaymentsByUser,
  getUserPaymentStats,
} from "../db/x402Operations";
import { x402Service } from "../x402/service";
import logger from "../utils/logger";

export const x402Route = new Elysia({ prefix: "/api/x402" })
  .get("/config", () => ({
    enabled: x402Config.enabled,
    network: x402Config.network,
    asset: x402Config.asset,
    facilitatorUrl: x402Config.facilitatorUrl,
    paymentAddress: x402Config.paymentAddress,
    usdcAddress: x402Config.usdcAddress,
  }))
  .get("/pricing", () => ({
    tools: Object.values(toolPricing),
    routes: routePricing,
  }))
  .get(
    "/payments/:userId",
    async ({ params: { userId }, set }) => {
      try {
        const payments = await getPaymentsByUser(userId, 50);
        return { ok: true, payments };
      } catch (error) {
        if (logger) logger.error({ error }, "x402_payments_query_failed");
        set.status = 500;
        return { ok: false, error: "Failed to fetch payments" };
      }
    },
  )
  .get(
    "/stats/:userId",
    async ({ params: { userId }, set }) => {
      try {
        const stats = await getUserPaymentStats(userId);
        return { ok: true, stats };
      } catch (error) {
        if (logger) logger.error({ error }, "x402_payment_stats_failed");
        set.status = 500;
        return { ok: false, error: "Failed to fetch stats" };
      }
    },
  )
  .get("/health", async ({ set }) => {
    try {
      const response = await fetch(`${x402Service.getFacilitatorUrl()}/supported`);
      const supported = await response.json();

      return {
        ok: response.ok,
        facilitatorAvailable: response.ok,
        supported,
      };
    } catch (error) {
      if (logger) logger.error({ error }, "x402_health_check_failed");
      set.status = 503;
      return {
        ok: false,
        facilitatorAvailable: false,
      };
    }
  });
