import { exact } from "x402/schemes";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  Price,
  Resource,
} from "x402/types";
import { useFacilitator } from "x402/verify";
import { processPriceToAtomicAmount } from "x402/shared";
import { createFacilitatorConfig } from "@coinbase/x402";
import logger from "../../utils/logger";
import { x402Config } from "./config";

/**
 * Field definition for x402scan schema validation
 */
export interface FieldDef {
  type?: string;
  required?: boolean | string[];
  description?: string;
  enum?: string[];
  properties?: Record<string, FieldDef>; // for nested objects
}

/**
 * Output schema for x402scan compliance
 * Describes the API input/output format for better UI integration
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

export function usdToBaseUnits(amountUSD: string): string {
  const [whole, fraction = ""] = amountUSD.split(".");
  const normalizedFraction = (fraction + "000000").slice(0, 6);
  return `${whole}${normalizedFraction}`.replace(/^0+/, "") || "0";
}

/**
 * Creates payment requirements for a given price and network
 *
 * @param price - The price to be paid for the resource
 * @param network - The blockchain network to use for payment
 * @param resource - The resource being accessed
 * @param description - Optional description of the payment
 * @returns Payment requirements object
 */
function createExactPaymentRequirements(
  price: Price,
  network: Network,
  resource: Resource,
  description = "",
  options?: {
    includeOutputSchema?: boolean;
    discoverable?: boolean;
    metadata?: Record<string, any>;
  },
): PaymentRequirements {
  const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
  if ("error" in atomicAmountForAsset) {
    throw new Error(atomicAmountForAsset.error);
  }
  const { maxAmountRequired, asset } = atomicAmountForAsset;

  const requirement: PaymentRequirements = {
    scheme: "exact",
    network,
    maxAmountRequired,
    resource,
    description,
    mimeType: "application/json",
    payTo: x402Config.paymentAddress as `0x${string}`,
    maxTimeoutSeconds: x402Config.defaultTimeout,
    asset: asset.address,
    extra: {
      name: "eip712" in asset ? asset.eip712.name : "USDC",
      version: "eip712" in asset ? asset.eip712.version : "2",
      ...(options?.metadata || {}),
    },
  };

  // Include outputSchema and config for x402scan + Bazaar discovery
  if (options?.includeOutputSchema) {
    // Input/Output schema for x402scan compliance
    requirement.outputSchema = {
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
            description:
              "Optional conversation ID for multi-turn conversations (UUID v4 format). Auto-generated if not provided.",
          },
          userId: {
            type: "string",
            required: false,
            description: "Optional user ID for tracking. Auto-generated if not provided.",
          },
        },
      },
      output: {
        text: {
          type: "string",
          description: "AI-generated response text",
        },
        files: {
          type: "array",
          description: "Optional metadata for processed files (filename, mimeType, size)",
          properties: {
            filename: { type: "string", description: "Name of the processed file" },
            mimeType: { type: "string", description: "MIME type of the file" },
            size: { type: "number", description: "File size in bytes" },
          },
        },
      },
    };

    // Bazaar discovery config - stored in 'extra' per x402scan schema
    // The 'extra' field is for custom provider data
    if (options?.discoverable !== false) {
      requirement.extra = {
        ...requirement.extra,
        // Bazaar discovery metadata
        discoverable: true,
        bazaar: {
          inputSchema: {
            bodyFields: {
              message: {
                type: "string",
                description: "User's question or message to the AI assistant",
                required: true,
              },
              conversationId: {
                type: "string",
                description: "Optional conversation ID for multi-turn conversations",
                required: false,
              },
              userId: {
                type: "string",
                description: "Optional user ID for tracking",
                required: false,
              },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "AI-generated response text" },
              userId: { type: "string", description: "User identifier" },
              conversationId: { type: "string", description: "Conversation identifier" },
              pollUrl: { type: "string", description: "URL to poll for async job status" },
            },
          },
        },
      };
    }
  }

  return requirement;
}

export class X402Service {
  private facilitator: ReturnType<typeof useFacilitator>;
  private x402Version = 1;

  constructor() {
    // Check if using CDP facilitator (requires authentication)
    const isCdpFacilitator = x402Config.facilitatorUrl.includes("cdp.coinbase.com");

    if (isCdpFacilitator) {
      // CDP facilitator requires JWT authentication using @coinbase/x402
      const cdpApiKeyId = process.env.CDP_API_KEY_ID;
      const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET;

      if (!cdpApiKeyId || !cdpApiKeySecret) {
        throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for CDP facilitator");
      }

      // Use the official Coinbase facilitator config helper
      // This automatically sets up the correct URL and auth headers
      const cdpConfig = createFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret);
      this.facilitator = useFacilitator(cdpConfig);

      if (logger) {
        logger.info(
          {
            environment: x402Config.environment,
            facilitatorUrl: x402Config.facilitatorUrl,
            network: x402Config.network,
            paymentAddress: x402Config.paymentAddress,
            facilitatorType: "CDP (JWT authenticated)",
          },
          "x402_service_initialized",
        );
      }
    } else {
      // Public facilitator (no authentication required)
      this.facilitator = useFacilitator({
        url: x402Config.facilitatorUrl as Resource,
      });

      if (logger) {
        logger.info(
          {
            environment: x402Config.environment,
            facilitatorUrl: x402Config.facilitatorUrl,
            network: x402Config.network,
            paymentAddress: x402Config.paymentAddress,
            facilitatorType: "public (no auth)",
          },
          "x402_service_initialized",
        );
      }
    }
  }

  getFacilitatorUrl(): string {
    return x402Config.facilitatorUrl;
  }

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
    return createExactPaymentRequirements(
      `$${amountUSD}` as Price,
      x402Config.network as Network,
      resource as Resource,
      description,
      options,
    );
  }

  async verifyPayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentVerificationResult> {
    try {
      // Decode payment using x402 library
      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = exact.evm.decodePayment(paymentHeader);
        decodedPayment.x402Version = this.x402Version;
      } catch (error) {
        if (logger) logger.error({ error }, "Failed to decode payment header");
        return {
          isValid: false,
          invalidReason: (error as Error)?.message || "Invalid or malformed payment header",
        };
      }

      // Debug: Log what we're sending to facilitator
      if (logger) {
        logger.info(
          {
            facilitatorUrl: x402Config.facilitatorUrl,
            verifyEndpoint: `${x402Config.facilitatorUrl}/verify`,
            environment: x402Config.environment,
            network: x402Config.network,
            payTo: paymentRequirements.payTo,
          },
          "x402_verify_request",
        );
      }

      // Use facilitator to verify
      const response = await this.facilitator.verify(decodedPayment, paymentRequirements);

      if (!response.isValid) {
        if (logger) {
          logger.error(
            {
              invalidReason: response.invalidReason,
              payer: response.payer,
            },
            "x402_verify_failed",
          );
        }
      }

      return response;
    } catch (error: any) {
      const message = error?.message || "Verification error";
      if (logger) logger.error({ error }, "x402_verification_error");
      return { isValid: false, invalidReason: message };
    }
  }

  async settlePayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentSettlementResult> {
    try {
      // Decode payment using x402 library
      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = exact.evm.decodePayment(paymentHeader);
        decodedPayment.x402Version = this.x402Version;
      } catch (e) {
        if (logger) logger.error({ error: e }, "Failed to decode payment header for settlement");
        return { success: false, errorReason: "Invalid payment header format" };
      }

      // Debug logging for settlement request
      if (logger) {
        logger.info(
          {
            url: `${x402Config.facilitatorUrl}/settle`,
            environment: x402Config.environment,
            network: x402Config.network,
          },
          "x402_settle_request",
        );
      }

      // Use facilitator to settle
      const response = await this.facilitator.settle(decodedPayment, paymentRequirements);

      if (!response.success) {
        if (logger) {
          logger.error(
            {
              errorReason: response.errorReason,
              network: response.network,
            },
            "x402_settle_failed",
          );
        }
      }

      return response;
    } catch (error: any) {
      const message = error?.message || "Settlement error";
      if (logger) {
        logger.error(
          {
            error: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
            cause: error?.cause,
          },
          "x402_settlement_error",
        );
      }
      return { success: false, errorReason: message };
    }
  }
}

export const x402Service = new X402Service();
