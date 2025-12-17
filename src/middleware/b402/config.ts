import { z } from "zod";

export type Environment = "testnet" | "mainnet";

export const B402ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  environment: z.enum(["testnet", "mainnet"]).default("testnet"),
  facilitatorUrl: z.string(),
  paymentAddress: z.string(),
  network: z.string(),
  asset: z.string().default("USDC"),
  tokenAddress: z.string(), // USDC or USDT address
  defaultTimeout: z.number().default(30),
});

export type B402Config = z.infer<typeof B402ConfigSchema>;

const NETWORK_CONFIG = {
  testnet: {
    network: "bnb-testnet", // Must match facilitator's network name
    // Local facilitator for testing
    facilitatorUrl: "http://localhost:8080",
    usdcAddress: "0x64544969ed7EBf5f083679233325356EbE738930", // BNB Testnet USDC
    usdtAddress: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // BNB Testnet USDT
    chainId: 97,
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
    explorer: "https://testnet.bscscan.com",
    relayerAddress: "0x62150F2c3A29fDA8bCf22c0F22Eb17270FCBb78A", // Testnet relayer
  },
  mainnet: {
    network: "bnb", // Must match facilitator's network name
    // Production facilitator (bioagents.dev)
    facilitatorUrl: "https://facilitator.bioagents.dev",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // BNB Mainnet USDC
    usdtAddress: "0x55d398326f99059fF775485246999027B3197955", // BNB Mainnet USDT
    chainId: 56,
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorer: "https://bscscan.com",
    relayerAddress: "0xE1C2830d5DDd6B49E9c46EbE03a98Cb44CD8eA5a", // Mainnet relayer
  },
} as const;

export type NetworkConfig = (typeof NETWORK_CONFIG)[Environment];

const env = (process.env.B402_ENVIRONMENT || "testnet") as Environment;
const networkDefaults = NETWORK_CONFIG[env];

if (!process.env.B402_PAYMENT_ADDRESS && process.env.B402_ENABLED === "true") {
  throw new Error(
    "B402_PAYMENT_ADDRESS is required when B402_ENABLED=true. Provide a payment address in your environment configuration.",
  );
}

// Determine token address based on asset type
const asset = process.env.B402_ASSET || "USDC";
const getDefaultTokenAddress = () => {
  if (asset === "USDC") {
    return networkDefaults.usdcAddress;
  }
  return networkDefaults.usdtAddress;
};

export const b402Config: B402Config = {
  enabled: process.env.B402_ENABLED === "true",
  environment: env,
  facilitatorUrl:
    process.env.B402_FACILITATOR_URL || networkDefaults.facilitatorUrl,
  paymentAddress: process.env.B402_PAYMENT_ADDRESS || "",
  network: process.env.B402_NETWORK || networkDefaults.network,
  asset: asset,
  tokenAddress:
    process.env.B402_USDC_ADDRESS || process.env.B402_USDT_ADDRESS || getDefaultTokenAddress(),
  defaultTimeout: Number(process.env.B402_TIMEOUT || 30),
};

export const networkConfig = {
  ...networkDefaults,
  chainId: networkDefaults.chainId,
  rpcUrl: networkDefaults.rpcUrl,
  explorer: networkDefaults.explorer,
  relayerAddress: networkDefaults.relayerAddress,
};

if (b402Config.enabled) {
  console.log("🟡 b402 enabled", {
    environment: b402Config.environment,
    network: b402Config.network,
    paymentAddress: b402Config.paymentAddress,
    facilitatorUrl: b402Config.facilitatorUrl,
  });
} else {
  console.log("🟡 b402 disabled (set B402_ENABLED=true to enable)");
}
