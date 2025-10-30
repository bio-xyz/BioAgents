import { createFacilitatorConfig } from "@coinbase/x402";
import logger from "../utils/logger";
import { x402Config } from "./config";

export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, any>;
}

export interface PaymentVerificationResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface PaymentSettlementResult {
  success: boolean;
  txHash?: string;
  networkId?: string;
  error?: string;
}

export function usdToBaseUnits(amountUSD: string): string {
  const [whole, fraction = ""] = amountUSD.split(".");
  const normalizedFraction = (fraction + "000000").slice(0, 6);
  return `${whole}${normalizedFraction}`.replace(/^0+/, "") || "0";
}

export class X402Service {
  private facilitator = (() => {
    // Only use CDP auth if using CDP facilitator
    const isCdpFacilitator = x402Config.facilitatorUrl?.includes("api.cdp.coinbase.com") ?? false;
    
    const config = isCdpFacilitator && process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
      ? createFacilitatorConfig(
          process.env.CDP_API_KEY_ID,
          process.env.CDP_API_KEY_SECRET,
        )
      : { url: x402Config.facilitatorUrl as `${string}://${string}` };

    if (x402Config.facilitatorUrl && typeof config === 'object' && 'url' in config) {
      config.url = x402Config.facilitatorUrl as `${string}://${string}`;
    }

    return config;
  })();

  getFacilitatorUrl(): string {
    return this.facilitator.url;
  }

  generatePaymentRequirement(
    resource: string,
    description: string,
    amountUSD: string,
  ): PaymentRequirement {
    return {
      scheme: "exact",
      network: x402Config.network,
      maxAmountRequired: usdToBaseUnits(amountUSD),
      resource,
      description,
      mimeType: "application/json",
      payTo: x402Config.paymentAddress,
      maxTimeoutSeconds: x402Config.defaultTimeout,
      asset: x402Config.usdcAddress, // Use USDC contract address, not symbol
      extra: {
        name: "USDC",
        version: "2",
      },
    };
  }

  async verifyPayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirement,
  ): Promise<PaymentVerificationResult> {
    try {
      const authHeaders = await this.facilitator.createAuthHeaders?.();

      // Decode payment header to get the payment payload
      let paymentPayload: any = null;
      try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        paymentPayload = JSON.parse(decoded);
      } catch (e) {
        if (logger) logger.error({ error: e }, "Failed to decode payment header");
        return { isValid: false, invalidReason: "Invalid payment header format" };
      }

      // Check if using CDP facilitator
      const isCdpFacilitator = this.facilitator.url.includes("api.cdp.coinbase.com");

      // Both CDP and x402.org use the same payload format now
      const payload = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements,
      };

      // Debug: Log what we're sending to facilitator
      if (logger) {
        const logData: any = {
          url: `${this.facilitator.url}/verify`,
          x402Version: 1,
          facilitatorType: isCdpFacilitator ? "CDP" : "x402.org",
          paymentRequirements: JSON.stringify(paymentRequirements),
          paymentHeaderLength: paymentHeader?.length || 0,
          fullPayload: JSON.stringify(payload).substring(0, 1000),
          authHeadersPresent: !!authHeaders,
          authVerifyKeys: authHeaders?.verify ? Object.keys(authHeaders.verify) : [],
        };

        // Add decoded payload for CDP, or indicate base64 for x402.org
        if (isCdpFacilitator && payload.paymentPayload) {
          logData.paymentPayload = JSON.stringify(payload.paymentPayload);
        }

        logger.info(logData, "x402_verify_request_full");
      }

      // Only use auth headers for CDP facilitator
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // For CDP facilitator, use auth headers if available
      if (isCdpFacilitator && authHeaders?.verify) {
        Object.assign(headers, authHeaders.verify);
      }
      // For x402.org, no auth headers needed

      const response = await fetch(`${this.facilitator.url}/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Try to get detailed error from response body
        let errorDetails = `Facilitator verify failed with status ${response.status}`;
        let fullErrorBody: any = null;

        try {
          const errorBody = await response.json();
          fullErrorBody = errorBody;

          if (errorBody?.error) {
            errorDetails = errorBody.error;
          } else if (errorBody?.message) {
            errorDetails = errorBody.message;
          } else if (errorBody?.invalidReason) {
            errorDetails = errorBody.invalidReason;
          }
        } catch {
          // If JSON parsing fails, use text
          try {
            const errorText = await response.text();
            if (errorText) {
              errorDetails = errorText;
              fullErrorBody = errorText;
            }
          } catch {
            // Keep default error message
          }
        }

        if (logger) {
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          logger.error({
            status: response.status,
            error: errorDetails,
            fullErrorBody: JSON.stringify(fullErrorBody),
            responseHeaders,
          }, "x402_verify_failed_detailed");
        }

        return { isValid: false, invalidReason: errorDetails };
      }

      const result = (await response.json()) as PaymentVerificationResult;
      return result;
    } catch (error: any) {
      const message = error?.message || "Verification error";
      if (logger) logger.error({ error }, "x402_verification_error");
      return { isValid: false, invalidReason: message };
    }
  }

  async settlePayment(
    paymentHeader: string,
    paymentRequirements: PaymentRequirement,
  ): Promise<PaymentSettlementResult> {
    try {
      const authHeaders = await this.facilitator.createAuthHeaders?.();

      // Decode payment header to get the payment payload
      let paymentPayload: any = null;
      try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        paymentPayload = JSON.parse(decoded);
      } catch (e) {
        if (logger) logger.error({ error: e }, "Failed to decode payment header for settlement");
        return { success: false, error: "Invalid payment header format" };
      }

      // Check if using CDP facilitator
      const isCdpFacilitator = this.facilitator.url.includes("api.cdp.coinbase.com");

      // Both CDP and x402.org use the same payload format
      const requestBody = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements,
      };

      // Only use auth headers for CDP facilitator
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // For CDP facilitator, use auth headers if available
      if (isCdpFacilitator && authHeaders?.settle) {
        Object.assign(headers, authHeaders.settle);
      }
      // For x402.org, no auth headers needed

      const response = await fetch(`${this.facilitator.url}/settle`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Try to get detailed error from response body
        let errorDetails = `Facilitator settle failed with status ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody?.error) {
            errorDetails = errorBody.error;
          } else if (errorBody?.message) {
            errorDetails = errorBody.message;
          }
        } catch {
          // If JSON parsing fails, use text
          try {
            const errorText = await response.text();
            if (errorText) errorDetails = errorText;
          } catch {
            // Keep default error message
          }
        }

        if (logger) logger.error({ status: response.status, error: errorDetails }, "x402_settle_failed");
        return { success: false, error: errorDetails };
      }

      return (await response.json()) as PaymentSettlementResult;
    } catch (error: any) {
      const message = error?.message || "Settlement error";
      if (logger) logger.error({ error }, "x402_settlement_error");
      return { success: false, error: message };
    }
  }
}

export const x402Service = new X402Service();
