import { Elysia } from "elysia";
import logger from "../../utils/logger";
import { x402Config } from "./config";
import { routePricing } from "./pricing";
import { x402Service } from "./service";

/**
 * x402 V2 Payment Middleware
 *
 * Enforces payment requirements using the x402 V2 protocol.
 * 
 * V2 Changes:
 * - Header: X-PAYMENT → PAYMENT-SIGNATURE
 * - Header: X-PAYMENT-RESPONSE → PAYMENT-RESPONSE
 * - Version: x402Version: 2
 */

// V2 Header names
const PAYMENT_SIGNATURE_HEADER = "payment-signature";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export interface X402MiddlewareOptions {
  enabled?: boolean;
}

export function x402Middleware(options: X402MiddlewareOptions = {}) {
  const enabled = options.enabled ?? x402Config.enabled;
  const plugin = new Elysia({ name: "x402-v2-middleware" });

  if (logger) {
    logger.info({
      enabled,
      environment: x402Config.environment,
      network: x402Config.network,
      paymentAddress: x402Config.paymentAddress,
      x402Version: 2,
    }, enabled ? "x402_v2_middleware_ENABLED" : "x402_v2_middleware_DISABLED");
  }

  if (!enabled) {
    return plugin;
  }

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
          "x402_v2_bypassed_for_whitelisted_user",
        );
      }
      return; // Skip x402 payment check
    }

    if (logger) logger.info(`x402_v2_checking_path: ${path}`);

    const pricing = routePricing.find((entry) => path.startsWith(entry.route));
    if (!pricing) {
      if (logger) logger.info(`x402 v2 no pricing found for ${path}, allowing request`);
      return;
    }

    if (logger) logger.info(`x402 v2 pricing found for ${path}: $${pricing.priceUSD}`);

    // V2: Check for PAYMENT-SIGNATURE header (also check legacy X-PAYMENT for compatibility)
    const paymentHeader = 
      request.headers.get(PAYMENT_SIGNATURE_HEADER) || 
      request.headers.get("x-payment"); // Legacy fallback

    // Debug headers
    if (logger) {
      const headers: Record<string, string> = {};
      request.headers.forEach((value: string, key: string) => {
        if (key.toLowerCase() === 'authorization' || key.toLowerCase().includes('payment')) {
          headers[key] = value ? `[present, ${value.length} chars]` : '[empty]';
        } else {
          headers[key] = value;
        }
      });
      logger.info({ path, headers, hasPayment: !!paymentHeader }, "x402_v2_request_headers");
    }

    // Build full URL for resource field
    const url = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || (x402Config.environment === "mainnet" ? "https" : url.protocol.replace(':', ''));
    const resourceUrl = `${protocol}://${url.host}${pricing.route}`;

    if (logger) {
      logger.info({
        path,
        requestUrl: request.url,
        forwardedProto,
        resolvedProtocol: protocol,
        resourceUrl,
      }, "x402_v2_resource_url_built");
    }
    
    if (!paymentHeader) {
      if (logger) logger.warn(`Payment required for ${path}, none provided`);

      // Generate V2 payment required response
      const paymentRequired = x402Service.generatePaymentRequired(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
        { includeOutputSchema: true }
      );

      set.status = 402;

      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity",
        },
      });
    }

    // Payment header provided, verify and settle
    if (logger) {
      logger.info({
        path,
        paymentHeaderLength: paymentHeader.length,
        paymentHeaderPrefix: paymentHeader.substring(0, 50),
      }, "x402_v2_payment_header_received");
    }

    const requirement = x402Service.generatePaymentRequirement(
      resourceUrl,
      pricing.description,
      pricing.priceUSD,
    );

    // Verify payment
    const verification = await x402Service.verifyPayment(paymentHeader, requirement);

    if (!verification.isValid) {
      if (logger) logger.warn(
        { path, reason: verification.invalidReason },
        "x402_v2_payment_invalid",
      );

      const paymentRequired = x402Service.generatePaymentRequired(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
      );
      paymentRequired.error = verification.invalidReason ?? "Invalid payment";

      set.status = 402;

      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "identity",
        },
      });
    }

    // Settle payment
    const settlement = await x402Service.settlePayment(paymentHeader, requirement);

    if (!settlement.success) {
      if (logger) logger.error(
        { path, errorReason: settlement.errorReason },
        "x402_v2_payment_settlement_failed",
      );

      const paymentRequired = x402Service.generatePaymentRequired(
        resourceUrl,
        pricing.description,
        pricing.priceUSD,
      );
      paymentRequired.error = settlement.errorReason ?? "Payment settlement failed";

      set.status = 402;

      return new Response(JSON.stringify(paymentRequired), {
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
        "x402_v2_payment_settled",
      );
    }

    // Store settlement info on request
    (request as any).x402Settlement = settlement;
    (request as any).x402Requirement = requirement;

    // V2: Set PAYMENT-RESPONSE header
    if (settlement.transaction && settlement.network) {
      const paymentResponseHeader = x402Service.encodeSettlementHeader({
        success: settlement.success,
        transaction: settlement.transaction,
        network: settlement.network as any,
        payer: settlement.payer,
      });
      set.headers[PAYMENT_RESPONSE_HEADER] = paymentResponseHeader;

      if (logger) {
        logger.info(
          { paymentResponseHeader: paymentResponseHeader.substring(0, 50) + "..." },
          "x402_v2_response_header_set",
        );
      }
    }

    return; // Continue to route handler
  });

  return plugin;
}
