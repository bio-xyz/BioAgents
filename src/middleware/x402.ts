import { Elysia } from "elysia";
import logger from "../utils/logger";
import { x402Config } from "../x402/config";
import { routePricing } from "../x402/pricing";
import { x402Service } from "../x402/service";

/**
 * x402 Payment Middleware
 *
 * Enforces payment requirements using the x402 protocol.
 * Can be bypassed for whitelisted users (e.g., Privy-authenticated).
 */

export interface X402MiddlewareOptions {
  enabled?: boolean;
}

export function x402Middleware(options: X402MiddlewareOptions = {}) {
  const enabled = options.enabled ?? x402Config.enabled;
  const plugin = new Elysia({ name: "x402-middleware" });

  if (!enabled) {
    if (logger) logger.info("x402_middleware_disabled");
    return plugin;
  }

  if (logger) logger.info("x402_middleware_enabled_and_active");

  plugin.onBeforeHandle({ as: 'scoped' }, async ({ request, path, set }: any) => {
    // Check if request should bypass x402 (whitelisted users)
    if ((request as any).bypassX402) {
      const user = (request as any).authenticatedUser;
      if (logger) {
        logger.info(
          {
            userId: user?.userId,
            authMethod: user?.authMethod,
            path,
          },
          "x402_bypassed_for_whitelisted_user",
        );
      }
      return; // Skip x402 payment check entirely
    }

    if (logger) logger.info(`x402_checking_path: ${path}`);

    const pricing = routePricing.find((entry) => path.startsWith(entry.route));
    if (!pricing) {
      if (logger) logger.info(`x402 no pricing found for ${path}, allowing request`);
      return; // Allow request to continue
    }

    if (logger) logger.info(`x402 pricing found for ${path}: $${pricing.priceUSD}`);

    const paymentHeader = request.headers.get("X-PAYMENT");
    
    // Build full URL for resource field (x402 requires full URL, not just path)
    const url = new URL(request.url);
    const resourceUrl = `${url.protocol}//${url.host}${pricing.route}`;
    
    if (!paymentHeader) {
      if (logger) logger.warn(`Payment required for ${path}, none provided`);

      const requirement = x402Service.generatePaymentRequirement(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
      );

      set.status = 402;
      set.headers["Content-Type"] = "application/json";

      return {
        x402Version: 1,
        accepts: [requirement],
        error: "Payment required",
      };
    }

    // Payment header provided, verify it
    // TODO: Add payment amount validation and duplicate tx_hash detection
    // - Parse payment header to extract tx_hash and amount
    // - Check if tx_hash already exists in x402_external or x402_payments (prevent duplicate payments)
    // - Validate payment amount matches or exceeds expected cost
    // - Store payment hash in cache with TTL to prevent replay attacks
    const requirement = x402Service.generatePaymentRequirement(
      resourceUrl,
      pricing.description,
      pricing.priceUSD,
    );

    const verification = await x402Service.verifyPayment(
      paymentHeader,
      requirement,
    );

    if (!verification.isValid) {
      if (logger) logger.warn(
        { path, reason: verification.invalidReason },
        "x402_payment_invalid",
      );

      set.status = 402;
      set.headers["Content-Type"] = "application/json";

      return {
        x402Version: 1,
        accepts: [requirement],
        error: verification.invalidReason ?? "Invalid payment",
      };
    }

    // Settle the payment
    const settlement = await x402Service.settlePayment(
      paymentHeader,
      requirement,
    );

    if (!settlement.success) {
      if (logger) logger.error(
        { path, error: settlement.error },
        "x402_payment_settlement_failed",
      );

      set.status = 402;
      set.headers["Content-Type"] = "application/json";

      return {
        x402Version: 1,
        accepts: [requirement],
        error: settlement.error ?? "Payment settlement failed",
      };
    }

    if (logger) {
      logger.info(
        { path, txHash: settlement.txHash },
        "x402_payment_settled",
      );
    }

    // Payment successful, allow request to continue
    // Store settlement info in context for route handler
    (request as any).x402Settlement = settlement;
    (request as any).x402Requirement = requirement;

    // Set X-PAYMENT-RESPONSE header for client
    // This allows x402-fetch to decode the payment response
    const paymentResponseData = {
      success: settlement.success,
      transaction: settlement.txHash,
      network: settlement.networkId || requirement.network,
    };
    
    // Encode payment response as base64 for header
    const paymentResponseHeader = Buffer.from(JSON.stringify(paymentResponseData)).toString("base64");
    set.headers["X-PAYMENT-RESPONSE"] = paymentResponseHeader;

    if (logger) {
      logger.info(
        { paymentResponseHeader: paymentResponseHeader.substring(0, 50) + "..." },
        "x402_response_header_set",
      );
    }

    return; // Continue to route handler
  });

  return plugin;
}
