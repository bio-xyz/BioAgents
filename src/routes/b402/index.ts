import { Elysia } from "elysia";
import { b402Config, networkConfig } from "../../middleware/b402/config";
import { b402RoutePricing } from "../../middleware/b402/pricing";
import { getOrCreateUserByWallet } from "../../db/operations";
import { b402Service } from "../../middleware/b402/service";
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
      tokenAddress: b402Config.tokenAddress,

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
              symbol: b402Config.asset,
              address: b402Config.tokenAddress,
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
  // /supported endpoint - returns supported payment kinds for BNB Chain
  // Client should query this first to determine the scheme (allowance vs exact)
  // Proxies to the actual facilitator to get the correct signer address
  .get("/supported", async ({ set }) => {
    try {
      // Query the actual facilitator for supported payment kinds
      const response = await fetch(`${b402Config.facilitatorUrl}/supported`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        return data;
      }

      // Fallback to static config if facilitator is unavailable
      if (logger) {
        logger.warn(
          { status: response.status },
          "b402_facilitator_supported_fallback",
        );
      }
    } catch (error) {
      if (logger) {
        logger.warn({ error }, "b402_facilitator_supported_error");
      }
    }

    // Fallback: return static config (may not have correct facilitator address)
    return {
      kinds: [
        {
          network: b402Config.network,
          scheme: "allowance",
          x402Version: 1,
          extra: {
            facilitatorAddress: networkConfig.relayerAddress,
            tokenAddress: b402Config.tokenAddress,
            tokenSymbol: b402Config.asset,
            tokenDecimals: 18,
            chainId: networkConfig.chainId,
          },
        },
      ],
    };
  })
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
