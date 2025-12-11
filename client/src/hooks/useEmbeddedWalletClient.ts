import { useMemo } from "preact/hooks";
import { createWalletClient, custom, type Transport, type Chain } from "viem";
import { base, baseSepolia, bsc, bscTestnet } from "viem/chains";

// Network to chain mapping
const CHAIN_MAP: Record<string, Chain> = {
  "base": base,
  "base-sepolia": baseSepolia,
  "bnb": bsc,
  "bnb-testnet": bscTestnet,
};

// Network to RPC URL mapping
const RPC_MAP: Record<string, string> = {
  "base": "https://base-rpc.publicnode.com",
  "base-sepolia": "https://base-sepolia-rpc.publicnode.com",
  "bnb": "https://bsc-dataseed1.binance.org",
  "bnb-testnet": "https://data-seed-prebsc-1-s1.binance.org:8545",
};

/**
 * Creates a viem-compatible wallet client from the Coinbase embedded wallet
 * This allows the embedded wallet to work with x402/b402 payments
 *
 * Supported networks:
 * - base, base-sepolia (x402 - USDC)
 * - bnb, bnb-testnet (b402 - USDT)
 *
 * @param network - Network identifier (base, base-sepolia, bnb, bnb-testnet)
 * @param x402Enabled - Whether payment protocols are enabled (determines if CDP hooks are used)
 */
export function useEmbeddedWalletClient(network?: string, x402Enabled: boolean = true) {
  // Safely get CDP hooks values - only when x402 is enabled
  let evmAddress: string | null = null;
  let signEvmTransaction: ((params: any) => Promise<any>) | null = null;
  let signEvmTypedData: ((params: any) => Promise<any>) | null = null;

  if (x402Enabled) {
    try {
      const cdpHooks = require("@coinbase/cdp-hooks");
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const addressResult = cdpHooks.useEvmAddress();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const signTxResult = cdpHooks.useSignEvmTransaction();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const signTypedDataResult = cdpHooks.useSignEvmTypedData();

      evmAddress = addressResult?.evmAddress ?? null;
      signEvmTransaction = signTxResult?.signEvmTransaction ?? null;
      signEvmTypedData = signTypedDataResult?.signEvmTypedData ?? null;
    } catch (err) {
      // CDP hooks not available - x402 disabled or provider not mounted
      console.debug("[useEmbeddedWalletClient] CDP hooks not available:", err);
    }
  }

  const chain = useMemo(() => {
    // Get chain from network parameter, default to base-sepolia
    return CHAIN_MAP[network || "base-sepolia"] || baseSepolia;
  }, [network]);

  const walletClient = useMemo(() => {
    if (!evmAddress || !signEvmTransaction || !signEvmTypedData) {
      return null;
    }

    // Create a custom transport that uses CDP's signing methods
    const transport = custom({
      async request({ method, params }: any) {
        // Handle signing requests
        if (method === "eth_sign" || method === "personal_sign") {
          // CDP handles message signing
          return null;
        }

        // Handle EIP-712 typed data signing (required for EIP-3009 gasless transfers)
        if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
          const [_address, typedDataString] = params;
          try {
            const typedData = typeof typedDataString === "string"
              ? JSON.parse(typedDataString)
              : typedDataString;

            const result = await signEvmTypedData({
              evmAccount: evmAddress,
              typedData,
            });

            return result.signature;
          } catch (error) {
            console.error("[useEmbeddedWalletClient] Sign typed data error:", error);
            throw error;
          }
        }

        if (method === "eth_signTransaction") {
          // Use CDP's signEvmTransaction
          const [tx] = params;
          try {
            const result = await signEvmTransaction({
              evmAccount: evmAddress,
              transaction: tx,
            });
            return result.signedTransaction;
          } catch (error) {
            console.error("[useEmbeddedWalletClient] Sign transaction error:", error);
            throw error;
          }
        }

        if (method === "eth_sendTransaction") {
          // For send transaction, we need to sign then send
          // This is handled by x402-fetch which will call eth_signTransaction
          throw new Error("eth_sendTransaction not directly supported - use signTransaction instead");
        }

        if (method === "eth_accounts" || method === "eth_requestAccounts") {
          return [evmAddress];
        }

        if (method === "eth_chainId") {
          return `0x${chain.id.toString(16)}`;
        }

        // Handle wallet-specific methods that shouldn't be forwarded
        if (method.startsWith("wallet_")) {
          // Handle specific wallet methods
          if (method === "wallet_switchEthereumChain") {
            // Can't switch chains in embedded wallet
            throw new Error("Chain switching not supported in embedded wallet");
          }

          if (method === "wallet_addEthereumChain") {
            // Can't add chains
            throw new Error("Adding chains not supported in embedded wallet");
          }

          if (method === "wallet_watchAsset") {
            // Silently ignore
            return true;
          }

          if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") {
            // Return basic permissions
            return [{ parentCapability: "eth_accounts" }];
          }

          // For other wallet methods, return null or throw
          throw new Error(`Wallet method ${method} not supported`);
        }

        // For other RPC methods, use a reliable public RPC endpoint
        try {
          // Get RPC URL based on network (supports Base and BNB chains)
          const rpcUrl = RPC_MAP[network || "base-sepolia"] || "https://base-sepolia-rpc.publicnode.com";

          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params,
            }),
          });

          const json = await response.json();
          if (json.error) {
            throw new Error(json.error.message || "RPC request failed");
          }
          return json.result;
        } catch (error) {
          console.error("[useEmbeddedWalletClient] RPC request failed:", method, error);
          throw error;
        }
      },
    });

    // Create the wallet client
    const client = createWalletClient({
      account: evmAddress as `0x${string}`,
      chain,
      transport: transport as Transport,
    });

    return client;
  }, [evmAddress, signEvmTransaction, signEvmTypedData, chain, network]);

  return walletClient;
}
