import { Elysia } from "elysia";
import { b402Config, networkConfig } from "../../b402/config";
import { b402RoutePricing } from "../../b402/pricing";
import { getOrCreateUserByWallet } from "../../db/operations";
import { b402Service } from "../../b402/service";
import logger from "../../utils/logger";

export const b402Route = new Elysia({ prefix: "/api/b402" })
  // b402 config endpoint
  .get("/config", () => {
    return {
      // Current active protocol info
      enabled: b402Config.enabled,
      protocol: "b402",
      network: b402Config.network,
      environment: b402Config.environment,
      asset: b402Config.asset,
      paymentAddress: b402Config.paymentAddress,

      // Protocol-specific fields
      facilitatorUrl: b402Config.facilitatorUrl,
      usdtAddress: b402Config.usdtAddress,

      // Chain info
      chainId: networkConfig.chainId,
      rpcUrl: networkConfig.rpcUrl,
      explorer: networkConfig.explorer,
      relayerAddress: networkConfig.relayerAddress,

      // Available networks (b402 supports BNB Chain)
      availableNetworks: [
        {
          id: b402Config.environment === "testnet" ? "bsc-testnet" : "bsc",
          protocol: "b402",
          name: b402Config.network,
          chainId: networkConfig.chainId,
          tokens: [
            {
              symbol: "USDT",
              address: b402Config.usdtAddress,
              decimals: 18,
            },
          ],
          facilitatorUrl: b402Config.facilitatorUrl,
          relayerAddress: networkConfig.relayerAddress,
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        },
      ],
    };
  })
  .get("/pricing", () => ({
    routes: b402RoutePricing,
  }))
  .get("/health", async ({ set }) => {
    try {
      const health = await b402Service.checkHealth();

      if (!health.ok) {
        set.status = 503;
      }

      return {
        ok: health.ok,
        facilitatorAvailable: health.ok,
        facilitatorUrl: b402Config.facilitatorUrl,
        error: health.error,
      };
    } catch (error) {
      if (logger) logger.error({ error }, "b402_health_check_failed");
      set.status = 503;
      return {
        ok: false,
        facilitatorAvailable: false,
        facilitatorUrl: b402Config.facilitatorUrl,
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
            "b402_user_lookup",
          );
        }

        return {
          ok: true,
          userId: user.id,
          wallet: user.wallet_address,
          isNew,
        };
      } catch (error) {
        if (logger) logger.error({ error }, "b402_user_lookup_failed");
        set.status = 500;
        return { ok: false, error: "Failed to lookup user" };
      }
    },
  );
