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
import logger from "../../utils/logger";
import { x402Config, networkConfig } from "./config";

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
  private x402Version = 2;

  constructor() {
    // Initialize HTTP facilitator client
    this.facilitatorClient = new HTTPFacilitatorClient({
      url: x402Config.facilitatorUrl,
    });

    if (logger) {
      logger.info(
        {
          environment: x402Config.environment,
          facilitatorUrl: x402Config.facilitatorUrl,
          network: x402Config.network,
          paymentAddress: x402Config.paymentAddress,
          x402Version: this.x402Version,
        },
        "x402_v2_service_initialized",
      );
    }
  }

  getFacilitatorUrl(): string {
    return x402Config.facilitatorUrl;
  }

  getVersion(): number {
    return this.x402Version;
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
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: x402Config.network as Network,
      asset: x402Config.usdcAddress,
      amount: usdToBaseUnits(amountUSD),
      payTo: x402Config.paymentAddress,
      maxTimeoutSeconds: x402Config.defaultTimeout,
      extra: {
        name: "USDC",
        version: "2",
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

    const paymentRequired: PaymentRequired = {
      x402Version: this.x402Version,
      resource: {
        url: resource,
        description: description,
        mimeType: "application/json",
      },
      accepts: [requirements],
    };

    // Add error field for compatibility
    (paymentRequired as any).error = "Payment required";

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
