import { Elysia } from "elysia";
import { x402Config, networkConfig } from "../../middleware/x402/config";
import { routePricing, toolPricing } from "../../middleware/x402/pricing";
import {
  getPaymentsByUser,
  getUserPaymentStats,
} from "../../db/x402Operations";
import { getOrCreateUserByWallet } from "../../db/operations";
import { x402Service } from "../../middleware/x402/service";
import logger from "../../utils/logger";

export const x402Route = new Elysia({ prefix: "/api/x402" })
  // x402 config endpoint
  .get("/config", () => {
    return {
      // Current active protocol info
      enabled: x402Config.enabled,
      protocol: "x402",
      network: x402Config.network,
      environment: x402Config.environment,
      asset: x402Config.asset,
      paymentAddress: x402Config.paymentAddress,

      // Protocol-specific fields
      facilitatorUrl: x402Config.facilitatorUrl,
      usdcAddress: x402Config.usdcAddress,

      // Chain info
      chainId: networkConfig.chainId,
      rpcUrl: networkConfig.rpcUrl,
      explorer: networkConfig.explorer,

      // Available networks (x402 only supports Base)
      availableNetworks: [
        {
          id: x402Config.environment === "testnet" ? "base-sepolia" : "base",
          protocol: "x402",
          name: x402Config.network,
          chainId: networkConfig.chainId,
          tokens: [
            {
              symbol: "USDC",
              address: x402Config.usdcAddress,
              decimals: 6,
            },
          ],
          facilitatorUrl: x402Config.facilitatorUrl,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        },
      ],
    };
  })
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
  })
  // Get or create user by wallet address - returns user UUID for conversation queries
  .get(
    "/user/:walletAddress",
    async ({ params: { walletAddress }, set }) => {
      try {
        if (!walletAddress || !walletAddress.startsWith("0x")) {
          set.status = 400;
          return { ok: false, error: "Invalid wallet address" };
        }

        const { user, isNew } = await getOrCreateUserByWallet(walletAddress);

        if (logger) {
          logger.info(
            { userId: user.id, wallet: walletAddress, isNew },
            "x402_user_lookup",
          );
        }

        return {
          ok: true,
          userId: user.id,
          wallet: user.wallet_address,
          isNew,
        };
      } catch (error) {
        if (logger) logger.error({ error }, "x402_user_lookup_failed");
        set.status = 500;
        return { ok: false, error: "Failed to lookup user" };
      }
    },
  );
