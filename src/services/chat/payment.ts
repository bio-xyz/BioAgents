import { createPayment, updateX402External } from "../../db/x402Operations";
import type { X402ExternalRecord } from "../../db/x402Operations";
import logger from "../../utils/logger";
import { x402Config } from "../../middleware/x402/config";
import { routePricing } from "../../middleware/x402/pricing";
import { usdToBaseUnits } from "../../middleware/x402/service";

export interface PaymentRecordingParams {
  isExternal: boolean;
  x402ExternalRecord?: X402ExternalRecord;
  userId: string;
  conversationId: string;
  messageId: string;
  paymentSettlement: any;
  paymentHeader: string;
  paymentRequirement: any;
  providers: string[];
  responseTime: number;
}

/**
 * Calculate the total cost based on route pricing
 */
export function calculateTotalCost(): number {
  // Use route-based flat pricing (simple, predictable)
  // Currently using $0.01 per request from routePricing in src/x402/pricing.ts
  // Tool-based dynamic pricing will be implemented later
  const chatRoutePricing = routePricing.find((entry) =>
    "/api/chat".startsWith(entry.route),
  );
  return chatRoutePricing ? parseFloat(chatRoutePricing.priceUSD) : 0.01;
}

/**
 * Record payment information based on request type
 */
export async function recordPayment(
  params: PaymentRecordingParams,
): Promise<void> {
  const {
    isExternal,
    x402ExternalRecord,
    userId,
    conversationId,
    messageId,
    paymentSettlement,
    paymentHeader,
    paymentRequirement,
    providers,
    responseTime,
  } = params;

  if (!x402Config.enabled || !paymentSettlement?.txHash) {
    return;
  }

  const totalCostUSD = calculateTotalCost();
  if (totalCostUSD <= 0) {
    return;
  }

  const amountUsdString = totalCostUSD.toFixed(2);
  const amountUsdNumber = totalCostUSD;

  try {
    if (isExternal) {
      // For external agents, update x402_external record
      if (x402ExternalRecord) {
        await updateX402External(x402ExternalRecord.id!, {
          tx_hash: paymentSettlement.txHash,
          amount_usd: amountUsdNumber,
          amount_wei: usdToBaseUnits(amountUsdString),
          asset: x402Config.asset,
          network: x402Config.network,
          network_id: paymentSettlement.networkId,
          payment_status: "settled",
          payment_header: paymentHeader ? { raw: paymentHeader } : null,
          payment_requirements: paymentRequirement ?? null,
          response_time: responseTime,
        });
        if (logger) {
          logger.info(
            {
              x402ExternalId: x402ExternalRecord.id,
              txHash: paymentSettlement.txHash,
            },
            "x402_external_payment_recorded",
          );
        }
      }
    } else {
      // For authenticated users (Privy/CDP), use x402_payments table
      await createPayment({
        user_id: userId,
        conversation_id: conversationId,
        message_id: messageId,
        amount_usd: amountUsdNumber,
        amount_wei: usdToBaseUnits(amountUsdString),
        asset: x402Config.asset,
        network: x402Config.network,
        tools_used: providers ?? [],
        tx_hash: paymentSettlement.txHash,
        network_id: paymentSettlement.networkId,
        payment_status: "settled",
        payment_header: paymentHeader ? { raw: paymentHeader } : null,
        payment_requirements: paymentRequirement ?? null,
      });
    }
  } catch (err) {
    if (logger) {
      logger.error({ err }, "x402_payment_record_failed");
    }
  }
}
