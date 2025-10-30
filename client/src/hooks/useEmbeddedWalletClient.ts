import { useMemo } from "preact/hooks";
import { useEvmAddress, useSignEvmTransaction, useSignEvmTypedData } from "@coinbase/cdp-hooks";
import { createWalletClient, custom, type Transport } from "viem";
import { base, baseSepolia } from "viem/chains";

/**
 * Creates a viem-compatible wallet client from the Coinbase embedded wallet
 * This allows the embedded wallet to work with x402 payments
 */
export function useEmbeddedWalletClient(network?: string) {
  const { evmAddress } = useEvmAddress();
  const { signEvmTransaction } = useSignEvmTransaction();
  const { signEvmTypedData } = useSignEvmTypedData();

  const chain = useMemo(() => {
    return network === "base" ? base : baseSepolia;
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
          // Use PublicNode as it's fast, free, and reliable
          const rpcUrl = network === "base"
            ? "https://base-rpc.publicnode.com"
            : "https://base-sepolia-rpc.publicnode.com";

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
