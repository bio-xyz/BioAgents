import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  HTTPFacilitatorClient,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentRequired,
  VerifyResponse,
  SettleResponse,
  Network,
} from "@x402/core/types";
import { createFacilitatorConfig } from "@coinbase/x402";
import logger from "../../utils/logger";
import { x402Config, networkConfig, X402_VERSION, hasCdpAuth, isCdpFacilitator } from "./config";
import { routePricing } from "./pricing";

/**
 * Field definition for API schema documentation
 */
export interface FieldDef {
  type?: string;
  required?: boolean | string[];
  description?: string;
  enum?: string[];
  properties?: Record<string, FieldDef>;
}

/**
 * Output schema for API documentation
 */
export interface OutputSchema {
  input: {
    type: "http";
    method: "GET" | "POST";
    bodyType?: "json" | "form-data" | "multipart-form-data" | "text" | "binary";
    queryParams?: Record<string, FieldDef>;
    bodyFields?: Record<string, FieldDef>;
    headerFields?: Record<string, FieldDef>;
  };
  output?: Record<string, any>;
}

export interface PaymentVerificationResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface PaymentSettlementResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Convert USD string to base units (6 decimals for USDC)
 */
export function usdToBaseUnits(amountUSD: string): string {
  const numericAmount = amountUSD.replace(/[^0-9.]/g, "");
  const [whole = "0", fraction = ""] = numericAmount.split(".");
  const normalizedFraction = (fraction + "000000").slice(0, 6);
  const result = `${whole}${normalizedFraction}`.replace(/^0+/, "") || "0";
  return result;
}

/**
 * x402 V2 Service
 * 
 * Handles payment verification and settlement using the x402 V2 protocol.
 */
export class X402Service {
  private facilitatorClient: HTTPFacilitatorClient;

  constructor() {
    let clientConfig: Parameters<typeof HTTPFacilitatorClient>[0];
    
    // Use official Coinbase facilitator config if CDP credentials are available
    if (isCdpFacilitator && hasCdpAuth) {
      // Use @coinbase/x402's createFacilitatorConfig which handles JWT auth properly
      clientConfig = createFacilitatorConfig(
        x402Config.cdpApiKeyId,
        x402Config.cdpApiKeySecret
      );
      if (logger) {
        logger.info({
          facilitatorUrl: clientConfig.url,
          cdpAuthEnabled: true,
        }, "x402_v2_cdp_auth_enabled");
      }
    } else if (isCdpFacilitator && !hasCdpAuth) {
      // CDP facilitator URL but no credentials - will fail
      clientConfig = { url: x402Config.facilitatorUrl };
      if (logger) {
        logger.warn(
          "x402_v2_cdp_auth_missing: CDP facilitator URL detected but CDP_API_KEY_ID/SECRET not set. " +
          "Auth will fail for mainnet. Set credentials or use X402_FACILITATOR_URL=https://x402.org/facilitator for testing."
        );
      }
    } else {
      // Non-CDP facilitator (e.g., x402.org)
      clientConfig = { url: x402Config.facilitatorUrl };
    }
    
    this.facilitatorClient = new HTTPFacilitatorClient(clientConfig);

    if (logger) {
      logger.info(
        {
          environment: x402Config.environment,
          facilitatorUrl: x402Config.facilitatorUrl,
          network: x402Config.network,
          paymentAddress: x402Config.paymentAddress,
          x402Version: X402_VERSION,
          cdpAuthEnabled: isCdpFacilitator && hasCdpAuth,
        },
        "x402_v2_service_initialized",
      );
    }
  }

  getFacilitatorUrl(): string {
    return x402Config.facilitatorUrl;
  }

  getVersion(): number {
    return X402_VERSION;
  }

  /**
   * Generate PaymentRequirements for V2
   * V2 structure: scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra
   */
  generatePaymentRequirement(
    resource: string,
    description: string,
    amountUSD: string,
    options?: {
      includeOutputSchema?: boolean;
      discoverable?: boolean;
      metadata?: Record<string, any>;
    },
  ): PaymentRequirements {
    // EIP-712 domain params must match the token contract's name() and version()
    // USDC on Base: name() = "USD Coin", version() = "2"
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: x402Config.network as Network,
      asset: x402Config.usdcAddress,
      amount: usdToBaseUnits(amountUSD),
      payTo: x402Config.paymentAddress,
      maxTimeoutSeconds: x402Config.defaultTimeout,
      extra: {
        name: "USD Coin",  // Must match USDC contract's name() for EIP-712
        version: "2",      // Must match USDC contract's version() for EIP-712
        // Store resource info in extra for compatibility
        resource,
        description,
        ...(options?.metadata || {}),
      },
    };

    // Add discoverable flag
    if (options?.discoverable !== false) {
      requirements.extra.discoverable = true;
    }

    return requirements;
  }

  /**
   * Generate a PaymentRequired response object for 402 responses
   * V2 structure includes resource info separately
   */
  generatePaymentRequired(
    resource: string,
    description: string,
    amountUSD: string,
    options?: {
      includeOutputSchema?: boolean;
      discoverable?: boolean;
      metadata?: Record<string, any>;
    },
  ): PaymentRequired {
    const requirements = this.generatePaymentRequirement(
      resource,
      description,
      amountUSD,
      options,
    );

    // Build payment required response
    // Note: 'error' field is added for client compatibility but is not part of v2 spec
    const paymentRequired: PaymentRequired & { error?: string } = {
      x402Version: X402_VERSION,
      resource: {
        url: resource,
        description: description,
        mimeType: "application/json",
      },
      accepts: [requirements],
      error: "Payment required",
    };

    // Add outputSchema for discovery
    if (options?.includeOutputSchema) {
      paymentRequired.extensions = {
        outputSchema: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            bodyFields: {
              message: {
                type: "string",
                required: true,
                description: "User's question or message to the AI assistant",
              },
              conversationId: {
                type: "string",
                required: false,
                description: "Optional conversation ID for multi-turn conversations",
              },
              userId: {
                type: "string",
                required: false,
                description: "Optional user ID for tracking",
              },
            },
          },
          output: {
            text: {
              type: "string",
              description: "AI-generated response text",
            },
            userId: {
              type: "string",
              description: "User identifier",
            },
            conversationId: {
              type: "string",
              description: "Conversation identifier",
            },
            pollUrl: {
              type: "string",
              description: "URL to poll for async job status",
            },
          },
        },
      };
    }

    return paymentRequired;
  }

  /**
   * Encode a PaymentRequired object for the PAYMENT-REQUIRED header
   */
  encodePaymentRequiredHeader(paymentRequired: PaymentRequired): string {
    return encodePaymentRequiredHeader(paymentRequired);
  }

  /**
   * Decode a payment signature header
   */
  decodePaymentHeader(paymentHeader: string): PaymentPayload {
    return decodePaymentSignatureHeader(paymentHeader);
  }

  /**
   * Verify a payment
   */
  async verifyPayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentVerificationResult> {
    try {
      // Decode payment from header
      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = this.decodePaymentHeader(paymentHeader);
      } catch (error) {
        if (logger) logger.error({ error }, "Failed to decode payment header");
        return {
          isValid: false,
          invalidReason: (error as Error)?.message || "Invalid or malformed payment header",
        };
      }

      if (logger) {
        logger.info(
          {
            facilitatorUrl: x402Config.facilitatorUrl,
            environment: x402Config.environment,
            network: x402Config.network,
            payTo: paymentRequirements.payTo,
          },
          "x402_v2_verify_request",
        );
      }

      // Use facilitator to verify
      const response: VerifyResponse = await this.facilitatorClient.verify(
        decodedPayment,
        paymentRequirements,
      );

      if (!response.isValid) {
        if (logger) {
          logger.error(
            {
              invalidReason: response.invalidReason,
              payer: response.payer,
            },
            "x402_v2_verify_failed",
          );
        }
      }

      return {
        isValid: response.isValid,
        invalidReason: response.invalidReason,
        payer: response.payer,
      };
    } catch (error: any) {
      const message = error?.message || "Verification error";
      if (logger) logger.error({ error }, "x402_v2_verification_error");
      return { isValid: false, invalidReason: message };
    }
  }

  /**
   * Settle a payment
   */
  async settlePayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentSettlementResult> {
    try {
      // Decode payment from header
      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = this.decodePaymentHeader(paymentHeader);
      } catch (e) {
        if (logger) logger.error({ error: e }, "Failed to decode payment header for settlement");
        return { success: false, errorReason: "Invalid payment header format" };
      }

      if (logger) {
        logger.info(
          {
            facilitatorUrl: x402Config.facilitatorUrl,
            environment: x402Config.environment,
            network: x402Config.network,
          },
          "x402_v2_settle_request",
        );
      }

      // Use facilitator to settle
      const response: SettleResponse = await this.facilitatorClient.settle(
        decodedPayment,
        paymentRequirements,
      );

      if (!response.success) {
        if (logger) {
          logger.error(
            {
              errorReason: response.errorReason,
              network: response.network,
            },
            "x402_v2_settle_failed",
          );
        }
        return {
          success: false,
          errorReason: response.errorReason,
        };
      }

      return {
        success: response.success,
        transaction: response.transaction,
        network: response.network,
        payer: response.payer,
      };
    } catch (error: any) {
      const message = error?.message || "Settlement error";
      if (logger) {
        logger.error(
          {
            error: error?.message || String(error),
            stack: error?.stack,
          },
          "x402_v2_settlement_error",
        );
      }
      return { success: false, errorReason: message };
    }
  }

  /**
   * Encode a settlement response for the PAYMENT-RESPONSE header
   */
  encodeSettlementHeader(settlement: SettleResponse): string {
    return encodePaymentResponseHeader(settlement);
  }
}

// Export singleton instance
export const x402Service = new X402Service();

/**
 * Consolidated 402 response generator for all x402 routes
 * 
 * Creates a standardized 402 Payment Required response with proper headers
 * for v2 client compatibility.
 * 
 * @param request - The incoming request (used for URL building)
 * @param routePath - The route path to look up pricing (e.g., "/api/x402/chat")
 * @param options - Optional overrides for description and price
 * @returns Response object with 402 status and PAYMENT-REQUIRED header
 */
export function create402Response(
  request: Request,
  routePath: string,
  options?: {
    description?: string;
    priceUSD?: string;
    includeOutputSchema?: boolean;
  }
): Response {
  // Look up pricing from centralized config
  const pricing = routePricing.find((entry) => routePath.startsWith(entry.route));
  
  // Build resource URL with correct protocol
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const resourceUrl = `${protocol}://${url.host}${routePath}`;

  const paymentRequired = x402Service.generatePaymentRequired(
    resourceUrl,
    options?.description || pricing?.description || "API access via x402 payment",
    options?.priceUSD || pricing?.priceUSD || "0.01",
    { includeOutputSchema: options?.includeOutputSchema ?? true }
  );

  // Encode for v2 clients that expect PAYMENT-REQUIRED header
  const paymentRequiredHeader = x402Service.encodePaymentRequiredHeader(paymentRequired);

  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "PAYMENT-REQUIRED": paymentRequiredHeader,
    },
  });
}
