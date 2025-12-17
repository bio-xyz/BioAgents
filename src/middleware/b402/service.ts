import logger from "../../utils/logger";
import { b402Config, networkConfig } from "./config";

/**
 * B402 Payment Service
 *
 * Handles payment verification and settlement for BNB Chain using the b402 protocol.
 * Uses a local facilitator at http://localhost:8080 for testing.
 */

export interface B402PaymentRequirement {
  scheme: "allowance" | "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
    facilitatorAddress: string; // For allowance scheme
    relayerAddress: string;
    chainId: number;
    [key: string]: any;
  };
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
 * Convert USD amount to USDT base units (18 decimals on BNB Chain)
 */
export function usdToBaseUnits(amountUSD: string): string {
  // USDT on BNB Chain has 18 decimals
  const [whole, fraction = ""] = amountUSD.split(".");
  const normalizedFraction = (fraction + "000000000000000000").slice(0, 18);
  return `${whole}${normalizedFraction}`.replace(/^0+/, "") || "0";
}

/**
 * Decoded payment payload from client - Allowance scheme for BNB Chain
 * Note: AllowanceTransfer does NOT have validAfter, only validBefore
 */
interface DecodedB402Payment {
  x402Version: number;
  scheme: "allowance";
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validBefore: string;
      nonce: string;
    };
  };
}

/**
 * Facilitator verify/settle request format
 */
interface FacilitatorRequest {
  x402Version: number;
  paymentPayload: DecodedB402Payment;
  paymentRequirements: B402PaymentRequirement;
}

/**
 * Facilitator verify response
 */
interface FacilitatorVerifyResponse {
  valid?: boolean;
  isValid?: boolean;
  payer?: string;
  invalidReason?: string;
  error?: string;
}

/**
 * Facilitator settle response
 */
interface FacilitatorSettleResponse {
  success?: boolean;
  transaction?: string;
  txHash?: string;
  network?: string;
  payer?: string;
  error?: string;
  errorReason?: string;
}

export class B402Service {
  private b402Version = 1;

  constructor() {
    if (logger) {
      logger.info(
        {
          environment: b402Config.environment,
          facilitatorUrl: b402Config.facilitatorUrl,
          network: b402Config.network,
          paymentAddress: b402Config.paymentAddress,
          chainId: networkConfig.chainId,
          relayerAddress: networkConfig.relayerAddress,
        },
        "b402_service_initialized",
      );
    }
  }

  getFacilitatorUrl(): string {
    return b402Config.facilitatorUrl;
  }

  generatePaymentRequirement(
    resource: string,
    description: string,
    amountUSD: string,
    options?: {
      metadata?: Record<string, any>;
    },
  ): B402PaymentRequirement {
    const maxAmountRequired = usdToBaseUnits(amountUSD);

    return {
      scheme: "allowance", // BNB Chain uses allowance scheme
      network: b402Config.network,
      maxAmountRequired,
      resource,
      description,
      mimeType: "application/json",
      payTo: b402Config.paymentAddress as `0x${string}`,
      maxTimeoutSeconds: b402Config.defaultTimeout,
      asset: b402Config.tokenAddress,
      extra: {
        // EIP-712 domain name must match the token contract's name() return value
        // BNB Chain USDC returns "USD Coin", not "USDC"
        name: "USD Coin",
        version: "1",
        facilitatorAddress: networkConfig.relayerAddress, // For allowance scheme
        relayerAddress: networkConfig.relayerAddress,
        chainId: networkConfig.chainId,
        ...(options?.metadata || {}),
      },
    };
  }

  /**
   * Decode base64-encoded payment header from client
   */
  private decodePaymentHeader(paymentHeader: string): DecodedB402Payment | null {
    try {
      // Handle both URL-safe and standard base64
      const normalizedHeader = paymentHeader
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const json = Buffer.from(normalizedHeader, "base64").toString("utf-8");
      const parsed = JSON.parse(json);

      // Validate required fields
      if (!parsed.payload?.signature || !parsed.payload?.authorization) {
        return null;
      }

      // Ensure all values are properly formatted as strings (per facilitator requirements)
      // For allowance scheme (BNB Chain), there is NO validAfter field - only validBefore
      const authorization = parsed.payload.authorization;
      return {
        x402Version: this.b402Version,
        scheme: "allowance", // BNB Chain uses allowance scheme
        network: parsed.network || b402Config.network,
        payload: {
          signature: parsed.payload.signature, // Signature is at payload level, not authorization
          authorization: {
            from: authorization.from,
            to: authorization.to,
            value: String(authorization.value),
            validBefore: String(authorization.validBefore),
            nonce: authorization.nonce,
          },
        },
      };
    } catch (error) {
      if (logger) logger.error({ error }, "Failed to decode b402 payment header");
      return null;
    }
  }

  async verifyPayment(
    paymentHeader: string,
    paymentRequirements: B402PaymentRequirement,
  ): Promise<PaymentVerificationResult> {
    try {
      // Decode the payment header
      const decodedPayment = this.decodePaymentHeader(paymentHeader);
      if (!decodedPayment) {
        return {
          isValid: false,
          invalidReason: "Invalid or malformed payment header",
        };
      }

      if (logger) {
        logger.info(
          {
            facilitatorUrl: b402Config.facilitatorUrl,
            verifyEndpoint: `${b402Config.facilitatorUrl}/verify`,
            network: b402Config.network,
            payTo: paymentRequirements.payTo,
            payer: decodedPayment.payload.authorization.from,
          },
          "b402_verify_request",
        );
      }

      // Build the facilitator request in the correct format
      const facilitatorRequest: FacilitatorRequest = {
        x402Version: this.b402Version,
        paymentPayload: decodedPayment,
        paymentRequirements: paymentRequirements,
      };

      // Debug: Log the exact request being sent to facilitator
      if (logger) {
        logger.info(
          {
            facilitatorRequest: JSON.stringify(facilitatorRequest, null, 2),
          },
          "b402_facilitator_request_debug",
        );
      }

      // Call facilitator verify endpoint
      const response = await fetch(`${b402Config.facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(facilitatorRequest),
        signal: AbortSignal.timeout(30000),
      });

      const result: FacilitatorVerifyResponse = await response.json();

      if (logger) {
        logger.info(
          { status: response.status, result },
          "b402_verify_response",
        );
      }

      // Handle error responses
      if (!response.ok || result.error) {
        const errorReason = result.error || result.invalidReason || `HTTP ${response.status}`;
        if (logger) {
          logger.error(
            { invalidReason: errorReason, status: response.status },
            "b402_verify_failed",
          );
        }
        return {
          isValid: false,
          invalidReason: errorReason,
          payer: decodedPayment.payload.authorization.from,
        };
      }

      // Check validity (facilitator may use 'valid' or 'isValid')
      const isValid = result.valid === true || result.isValid === true;

      return {
        isValid,
        invalidReason: result.invalidReason,
        payer: result.payer || decodedPayment.payload.authorization.from,
      };
    } catch (error: any) {
      const message = error?.message || "Verification error";
      if (logger) logger.error({ error }, "b402_verification_error");
      return { isValid: false, invalidReason: message };
    }
  }

  async settlePayment(
    paymentHeader: string,
    paymentRequirements: B402PaymentRequirement,
  ): Promise<PaymentSettlementResult> {
    try {
      // Decode the payment header
      const decodedPayment = this.decodePaymentHeader(paymentHeader);
      if (!decodedPayment) {
        return { success: false, errorReason: "Invalid payment header format" };
      }

      if (logger) {
        logger.info(
          {
            url: `${b402Config.facilitatorUrl}/settle`,
            environment: b402Config.environment,
            network: b402Config.network,
            payer: decodedPayment.payload.authorization.from,
          },
          "b402_settle_request",
        );
      }

      // Build the facilitator request in the correct format
      const facilitatorRequest: FacilitatorRequest = {
        x402Version: this.b402Version,
        paymentPayload: decodedPayment,
        paymentRequirements: paymentRequirements,
      };

      // Call facilitator settle endpoint
      const response = await fetch(`${b402Config.facilitatorUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(facilitatorRequest),
        signal: AbortSignal.timeout(60000), // Longer timeout for settlement
      });

      const result: FacilitatorSettleResponse = await response.json();

      if (logger) {
        logger.info(
          { status: response.status, result },
          "b402_settle_response",
        );
      }

      // Handle error responses
      if (!response.ok || result.error) {
        const errorReason = result.error || result.errorReason || `HTTP ${response.status}`;
        if (logger) {
          logger.error(
            { errorReason, status: response.status },
            "b402_settle_failed",
          );
        }
        return {
          success: false,
          errorReason,
          payer: decodedPayment.payload.authorization.from,
          network: b402Config.network,
        };
      }

      return {
        success: result.success === true,
        transaction: result.transaction || result.txHash,
        network: result.network || b402Config.network,
        payer: result.payer || decodedPayment.payload.authorization.from,
        errorReason: result.errorReason,
      };
    } catch (error: any) {
      const message = error?.message || "Settlement error";
      if (logger) logger.error({ error }, "b402_settlement_error");
      return { success: false, errorReason: message };
    }
  }

  /**
   * Check facilitator health
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${b402Config.facilitatorUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return { ok: true };
      }

      return { ok: false, error: `Status: ${response.status}` };
    } catch (error: any) {
      return { ok: false, error: error?.message || "Connection failed" };
    }
  }
}

export const b402Service = new B402Service();
