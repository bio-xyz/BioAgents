import { Elysia } from "elysia";
import { settleResponseHeader } from "x402/types";
import logger from "../../utils/logger";
import { x402Config } from "./config";
import { routePricing } from "./pricing";
import { x402Service } from "./service";

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

  // Always log middleware status at initialization
  if (logger) {
    logger.info({
      enabled,
      environment: x402Config.environment,
      network: x402Config.network,
      paymentAddress: x402Config.paymentAddress,
      X402_ENABLED_ENV: process.env.X402_ENABLED,
    }, enabled ? "x402_middleware_ENABLED" : "x402_middleware_DISABLED");
  }

  if (!enabled) {
    return plugin;
  }

  // Use 'scoped' so this hook applies to routes in the parent that uses this plugin
  plugin.onBeforeHandle({ as: "scoped" }, async ({ request, path, set }: any) => {
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

    // Debug: Log all request headers to diagnose payment header issues
    if (logger) {
      const headers: Record<string, string> = {};
      request.headers.forEach((value: string, key: string) => {
        // Redact sensitive headers
        if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-payment') {
          headers[key] = value ? `[present, ${value.length} chars]` : '[empty]';
        } else {
          headers[key] = value;
        }
      });
      logger.info({ path, headers, hasPayment: !!paymentHeader }, "x402_request_headers");
    }

    // Build full URL for resource field (x402 requires full URL, not just path)
    // Check X-Forwarded-Proto header for correct protocol (ngrok, reverse proxies)
    const url = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    // Default to https in production if x-forwarded-proto is missing
    const protocol = forwardedProto || (x402Config.environment === "mainnet" ? "https" : url.protocol.replace(':', ''));
    const resourceUrl = `${protocol}://${url.host}${pricing.route}`;

    if (logger) {
      logger.info({
        path,
        requestUrl: request.url,
        forwardedProto,
        resolvedProtocol: protocol,
        resourceUrl,
      }, "x402_resource_url_built");
    }
    
    if (!paymentHeader) {
      if (logger) logger.warn(`Payment required for ${path}, none provided`);

      // Include outputSchema for external consumers (x402scan compliance)
      const requirement = x402Service.generatePaymentRequirement(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
        {
          includeOutputSchema: true, // External consumer needs full schema
        }
      );

      set.status = 402;

      const responseData = {
        x402Version: 1,
        accepts: [requirement],
        error: "Payment required",
      };

      // Return explicit Response to prevent compression
      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity", // Explicitly disable compression
        },
      });
    }

    // Payment header provided, verify it
    // TODO: Add payment amount validation and duplicate tx_hash detection
    // - Parse payment header to extract tx_hash and amount
    // - Check if tx_hash already exists in x402_external or x402_payments (prevent duplicate payments)
    // - Validate payment amount matches or exceeds expected cost
    // - Store payment hash in cache with TTL to prevent replay attacks

    // Debug: Log payment header details
    if (logger) {
      logger.info({
        path,
        paymentHeaderLength: paymentHeader.length,
        paymentHeaderPrefix: paymentHeader.substring(0, 50),
      }, "x402_payment_header_received");
    }

    // For verification/settlement, outputSchema not needed (simpler payload)
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

      const responseData = {
        x402Version: 1,
        accepts: [requirement],
        error: verification.invalidReason ?? "Invalid payment",
      };

      // Return explicit Response to prevent compression
      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity", // Explicitly disable compression
        },
      });
    }

    // Settle the payment
    const settlement = await x402Service.settlePayment(
      paymentHeader,
      requirement,
    );

    if (!settlement.success) {
      if (logger) logger.error(
        { path, errorReason: settlement.errorReason },
        "x402_payment_settlement_failed",
      );

      set.status = 402;

      const responseData = {
        x402Version: 1,
        accepts: [requirement],
        error: settlement.errorReason ?? "Payment settlement failed",
      };

      // Return explicit Response to prevent compression
      return new Response(JSON.stringify(responseData), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity", // Explicitly disable compression
        },
      });
    }

    if (logger) {
      logger.info(
        { path, transaction: settlement.transaction, network: settlement.network },
        "x402_payment_settled",
      );
    }

    // Payment successful, allow request to continue
    // Store settlement info on request for route handlers and authResolver
    (request as any).x402Settlement = settlement;
    (request as any).x402Requirement = requirement;

    // Set X-PAYMENT-RESPONSE header for client using official x402 encoder
    // Ensure required fields are present
    if (settlement.transaction && settlement.network) {
      const paymentResponseHeader = settleResponseHeader({
        success: settlement.success,
        transaction: settlement.transaction,
        network: settlement.network as any,
        payer: settlement.payer,
      });
      set.headers["X-PAYMENT-RESPONSE"] = paymentResponseHeader;

      if (logger) {
        logger.info(
          { paymentResponseHeader: paymentResponseHeader.substring(0, 50) + "..." },
          "x402_response_header_set",
        );
      }
    }

    return; // Continue to route handler
  });

  return plugin;
}
