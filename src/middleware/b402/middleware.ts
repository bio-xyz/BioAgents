import { Elysia } from "elysia";
import logger from "../../utils/logger";
import { b402Config } from "./config";
import { b402RoutePricing } from "./pricing";
import { b402Service } from "./service";

/**
 * b402 Payment Middleware
 *
 * Enforces payment requirements using the b402 protocol (BNB Chain).
 * Uses local facilitator at http://localhost:8080 for testing.
 */

export interface B402MiddlewareOptions {
  enabled?: boolean;
}

export function b402Middleware(options: B402MiddlewareOptions = {}) {
  const enabled = options.enabled ?? b402Config.enabled;
  const plugin = new Elysia({ name: "b402-middleware", scoped: false });

  if (!enabled) {
    if (logger) logger.info("b402_middleware_disabled");
    return plugin;
  }

  if (logger) logger.info("b402_middleware_enabled_and_active");

  // Use 'scoped' so this hook applies to routes in the parent that uses this plugin
  plugin.onBeforeHandle({ as: "scoped" }, async ({ request, path, set }: any) => {
    // Check if request should bypass b402 (whitelisted users)
    if ((request as any).bypassB402) {
      const user = (request as any).authenticatedUser;
      if (logger) {
        logger.info(
          {
            userId: user?.userId,
            authMethod: user?.authMethod,
            path,
          },
          "b402_bypassed_for_whitelisted_user",
        );
      }
      return; // Skip b402 payment check entirely
    }

    if (logger) logger.info(`b402_checking_path: ${path}`);

    const pricing = b402RoutePricing.find((entry) => path.startsWith(entry.route));
    if (!pricing) {
      if (logger) logger.info(`b402 no pricing found for ${path}, allowing request`);
      return; // Allow request to continue
    }

    if (logger) logger.info(`b402 pricing found for ${path}: $${pricing.priceUSD}`);

    const paymentHeader = request.headers.get("X-PAYMENT");

    // Build full URL for resource field
    const url = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || url.protocol.replace(":", "");
    const resourceUrl = `${protocol}://${url.host}${pricing.route}`;

    if (!paymentHeader) {
      if (logger) logger.warn(`b402 Payment required for ${path}, none provided`);

      const requirement = b402Service.generatePaymentRequirement(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
      );

      set.status = 402;

      const responseData = {
        b402Version: 1,
        protocol: "b402",
        accepts: [requirement],
        error: "Payment required",
      };

      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity",
        },
      });
    }

    // Payment header provided, verify it
    if (logger) {
      logger.info(
        {
          path,
          paymentHeaderLength: paymentHeader.length,
          paymentHeaderPrefix: paymentHeader.substring(0, 50),
        },
        "b402_payment_header_received",
      );
    }

    const requirement = b402Service.generatePaymentRequirement(
      resourceUrl,
      pricing.description,
      pricing.priceUSD,
    );

    const verification = await b402Service.verifyPayment(paymentHeader, requirement);

    if (!verification.isValid) {
      if (logger)
        logger.warn({ path, reason: verification.invalidReason }, "b402_payment_invalid");

      set.status = 402;

      const responseData = {
        b402Version: 1,
        protocol: "b402",
        accepts: [requirement],
        error: verification.invalidReason ?? "Invalid payment",
      };

      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity",
        },
      });
    }

    // Settle the payment
    const settlement = await b402Service.settlePayment(paymentHeader, requirement);

    if (!settlement.success) {
      if (logger)
        logger.error({ path, errorReason: settlement.errorReason }, "b402_payment_settlement_failed");

      set.status = 402;

      const responseData = {
        b402Version: 1,
        protocol: "b402",
        accepts: [requirement],
        error: settlement.errorReason ?? "Payment settlement failed",
      };

      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity",
        },
      });
    }

    if (logger) {
      logger.info(
        { path, transaction: settlement.transaction, network: settlement.network },
        "b402_payment_settled",
      );
    }

    // Payment successful, store settlement info in context
    (request as any).b402Settlement = settlement;
    (request as any).b402Requirement = requirement;

    // Set X-PAYMENT-RESPONSE header for client
    if (settlement.transaction && settlement.network) {
      const responseData = {
        success: true,
        protocol: "b402",
        transaction: settlement.transaction,
        network: settlement.network,
        payer: settlement.payer,
      };
      set.headers["X-PAYMENT-RESPONSE"] = Buffer.from(JSON.stringify(responseData)).toString(
        "base64",
      );

      if (logger) {
        logger.info({ transaction: settlement.transaction }, "b402_response_header_set");
      }
    }

    return; // Continue to route handler
  });

  return plugin;
}
