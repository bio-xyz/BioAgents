export interface B402RoutePricing {
  route: string;
  priceUSD: string;
  description: string;
}

/**
 * B402 Route-level pricing
 *
 * Same pricing structure as x402, but for BNB Chain payments with USDT.
 */
export const b402RoutePricing: B402RoutePricing[] = [
  // b402 payment routes
  {
    route: "/api/b402/chat",
    priceUSD: "0.01", // Same as x402 chat
    description: "Chat API access via b402 payment (BNB Chain)",
  },
  {
    route: "/api/b402/deep-research/start",
    priceUSD: "0.025", // Same as x402 deep research
    description: "Deep research initiation via b402 payment (BNB Chain)",
  },
  // Note: /api/b402/deep-research/status/:messageId is FREE (no payment)
];
