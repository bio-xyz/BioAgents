export type PricingTier = "free" | "basic" | "premium";

export interface ToolPricing {
  tool: string;
  priceUSD: string;
  tier: PricingTier;
  description: string;
  costToYouUSD?: string; // Optional: Track your actual cost
}

export interface RoutePricing {
  route: string;
  priceUSD: string;
  description: string;
}

/**
 * RECOMMENDED PRICING MODEL FOR BIOAGENTS
 *
 * Philosophy:
 * 1. Core infrastructure (PLANNING, REPLY, KNOWLEDGE) should be FREE
 * 2. Only charge for expensive external APIs (OpenScholar, Semantic Scholar)
 * 3. Keep prices reasonable ($0.05-0.10 per request)
 * 4. Consider your actual costs (LLM, APIs)
 *
 * Pricing Tiers:
 * - FREE: Core functionality everyone needs (planning, reply, knowledge)
 * - BASIC: Enhanced features ($0.05)
 * - PREMIUM: Expensive external APIs ($0.10)
 */
export const toolPricing: Record<string, ToolPricing> = {
  // ===== FREE TIER (Core Framework) =====
  // These should NEVER be charged - they're the base system

  PLANNING: {
    tool: "PLANNING",
    priceUSD: "0.00", // FREE - This is core routing logic
    tier: "free",
    description: "Request planning (core system)",
  },

  REPLY: {
    tool: "REPLY",
    priceUSD: "0.00", // FREE - LLM costs are covered by your margin
    tier: "free",
    description: "Response generation (included)",
    costToYouUSD: "0.01", // Your LLM cost per request
  },

  KNOWLEDGE: {
    tool: "KNOWLEDGE",
    priceUSD: "0.00", // FREE - It's your own knowledge base
    tier: "free",
    description: "Knowledge base retrieval (included)",
  },

  "FILE-UPLOAD": {
    tool: "FILE-UPLOAD",
    priceUSD: "0.00", // FREE - Just file processing
    tier: "free",
    description: "File upload and processing (included)",
  },

  // ===== BASIC TIER (Enhanced Features) =====
  // Charge a small amount for advanced features

  HYPOTHESIS: {
    tool: "HYPOTHESIS",
    priceUSD: "0.05", // $0.05 - Advanced reasoning
    tier: "basic",
    description: "Hypothesis generation (advanced reasoning)",
    costToYouUSD: "0.01", // Your cost (LLM with longer context)
  },

  // ===== PREMIUM TIER (External APIs) =====
  // Charge for expensive third-party services

  OPENSCHOLAR: {
    tool: "OPENSCHOLAR",
    priceUSD: "0.10", // $0.10 - External API + processing
    tier: "premium",
    description: "OpenScholar scientific paper retrieval",
    costToYouUSD: "0.05", // Your actual cost from OpenScholar API
  },

  "SEMANTIC-SCHOLAR": {
    tool: "SEMANTIC-SCHOLAR",
    priceUSD: "0.10", // $0.10 - External API + synthesis
    tier: "premium",
    description: "Semantic Scholar research synthesis",
    costToYouUSD: "0.05", // Your cost (API + Claude for synthesis)
  },
};

/**
 * Get total price for all premium tools (useful for analytics)
 */
export function getTotalPremiumToolsPrice(): number {
  return Object.values(toolPricing).reduce((sum, tool) => {
    const amount = Number.parseFloat(tool.priceUSD || "0");
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

/**
 * Route-level pricing (RECOMMENDED)
 *
 * Option 1: Flat rate per request (simple, predictable)
 * Option 2: Dynamic based on tools used (fair, but complex)
 *
 * For BioAgents, flat rate makes sense:
 * - Most requests are similar complexity
 * - Users want predictable pricing
 * - Simpler to implement
 */
export const routePricing: RoutePricing[] = [

  // x402 payment routes
  {
    route: "/api/x402/chat",
    priceUSD: "0.01", // Same as standard chat
    description: "Chat API access via x402 payment",
  },
  {
    route: "/api/x402/deep-research/start",
    priceUSD: "0.025", // Higher price for deep research (more resources)
    description: "Deep research initiation via x402 payment",
  },
  // Note: /api/x402/deep-research/status/:messageId is FREE (no payment)
  // Security: Handler validates ownership via userId query param
];

/**
 * Calculate price for specific tool combination
 *
 * NOTE: This returns $0.00 for most requests now since
 * core tools (PLANNING, REPLY, KNOWLEDGE) are free.
 * Only premium tools add cost.
 */
export function calculateRequestPrice(providers: string[]): string {
  const total = providers.reduce((sum, provider) => {
    const pricing = toolPricing[provider];
    if (!pricing) return sum;
    const price = Number.parseFloat(pricing.priceUSD);
    return sum + (Number.isFinite(price) ? price : 0);
  }, 0);

  return total.toFixed(2);
}

/**
 * Calculate your profit margin
 */
export function calculateProfit(providers: string[]): {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
} {
  const revenue = parseFloat(calculateRequestPrice(providers));
  const cost = providers.reduce((sum, provider) => {
    const pricing = toolPricing[provider];
    if (!pricing?.costToYouUSD) return sum;
    return sum + parseFloat(pricing.costToYouUSD);
  }, 0);

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return { revenue, cost, profit, margin };
}

/**
 * Pricing examples with new model:
 *
 * Example 1: Simple question
 * Tools: [PLANNING, KNOWLEDGE, REPLY]
 * Cost: $0.00 (all free!)
 *
 * Example 2: Research question
 * Tools: [PLANNING, OPENSCHOLAR, REPLY]
 * Cost: $0.10 (only OpenScholar charged)
 *
 * Example 3: Advanced research
 * Tools: [PLANNING, OPENSCHOLAR, SEMANTIC-SCHOLAR, HYPOTHESIS, REPLY]
 * Cost: $0.25 ($0.10 + $0.10 + $0.05)
 *
 * Example 4: Route-based (RECOMMENDED)
 * Route: /api/chat
 * Cost: $0.10 (flat rate, regardless of tools used)
 */
