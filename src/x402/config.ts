import { z } from "zod";

export type Environment = "testnet" | "mainnet";

export const X402ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  environment: z.enum(["testnet", "mainnet"]).default("testnet"),
  facilitatorUrl: z.string(),
  paymentAddress: z.string(),
  network: z.string(),
  asset: z.string().default("USDC"),
  usdcAddress: z.string(),
  defaultTimeout: z.number().default(30),
});

export type X402Config = z.infer<typeof X402ConfigSchema>;

const NETWORK_CONFIG = {
  testnet: {
    network: "base-sepolia",
    // Using x402.org facilitator (open-source, no auth required)
    facilitatorUrl: "https://x402.org/facilitator",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    useCdpFacilitator: false,
  },
  mainnet: {
    network: "base",
    // Recommended: Use CDP facilitator for production (set X402_FACILITATOR_URL in .env)
    // CDP: https://api.cdp.coinbase.com/platform/v2/x402 (requires CDP_API_KEY_ID/SECRET)
    facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    useCdpFacilitator: true, // Default: CDP facilitator (override with X402_FACILITATOR_URL)
  },
} as const;

export type NetworkConfig = (typeof NETWORK_CONFIG)[Environment];

const env = (process.env.X402_ENVIRONMENT || "testnet") as Environment;
const networkDefaults = NETWORK_CONFIG[env];

if (!process.env.X402_PAYMENT_ADDRESS && process.env.X402_ENABLED === "true") {
  throw new Error(
    "X402_PAYMENT_ADDRESS is required when X402_ENABLED=true. Provide a payment address in your environment configuration.",
  );
}

export const x402Config: X402Config = {
  enabled: process.env.X402_ENABLED === "true",
  environment: env,
  facilitatorUrl:
    process.env.X402_FACILITATOR_URL || networkDefaults.facilitatorUrl,
  paymentAddress: process.env.X402_PAYMENT_ADDRESS || "",
  network: process.env.X402_NETWORK || networkDefaults.network,
  asset: process.env.X402_ASSET || "USDC",
  usdcAddress:
    process.env.X402_USDC_ADDRESS || networkDefaults.usdcAddress,
  defaultTimeout: Number(process.env.X402_TIMEOUT || 30),
};

export const networkConfig = {
  ...networkDefaults,
  chainId: networkDefaults.chainId,
  rpcUrl: networkDefaults.rpcUrl,
  explorer: networkDefaults.explorer,
};

if (x402Config.enabled) {
  console.log("🔷 x402 enabled", {
    environment: x402Config.environment,
    network: x402Config.network,
    paymentAddress: x402Config.paymentAddress,
  });
} else {
  console.log("🔷 x402 disabled (set X402_ENABLED=true to enable)");
}
