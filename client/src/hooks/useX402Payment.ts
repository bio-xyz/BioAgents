import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  createWalletClient,
  custom,
  publicActions,
  type Address,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import type { Signer } from "x402/types";
import { useToast } from "./useToast";

// Protocol type
type PaymentProtocol = "x402" | "b402";

// Network info from server
type NetworkInfo = {
  id: string;
  protocol: PaymentProtocol;
  name: string;
  chainId: number;
  tokens: Array<{
    symbol: string;
    address: string;
    decimals: number;
  }>;
  facilitatorUrl: string;
  relayerAddress?: string | null;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

type X402ConfigResponse = {
  enabled?: boolean;
  protocol?: PaymentProtocol;
  network?: string;
  environment?: string;
  asset?: string;
  facilitatorUrl?: string;
  paymentAddress?: string;
  usdcAddress?: string;
  relayerAddress?: string | null;
  chainId?: number;
  rpcUrl?: string;
  explorer?: string;
  availableNetworks?: NetworkInfo[];
};

type PricingResponse = {
  tools?: Array<{
    tool: string;
    priceUSD: string;
    tier: string;
    description: string;
  }>;
  routes?: Array<{
    route: string;
    priceUSD: string;
    description: string;
  }>;
};

export interface UseX402PaymentReturn {
  config: X402ConfigResponse | null;
  pricing: PricingResponse | null;
  loading: boolean;
  enabled: boolean;
  canSign: boolean;
  walletAddress: string | null;
  isConnecting: boolean;
  error: string | null;
  usdcBalance: string | null;
  isCheckingBalance: boolean;
  hasInsufficientBalance: boolean;
  // Protocol info
  protocol: PaymentProtocol;
  availableNetworks: NetworkInfo[];
  // Methods
  refresh: () => Promise<void>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  fetchWithPayment: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  decodePaymentResponse: typeof decodeXPaymentResponse;
  checkBalance: () => Promise<void>;
  setEmbeddedWalletClient: (client: any, address: string) => void;
}

export function useX402Payment(): UseX402PaymentReturn {
  const toast = useToast();
  const [config, setConfig] = useState<X402ConfigResponse | null>(null);
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const signerRef = useRef<Signer | null>(null);
  const signerPromiseRef = useRef<Promise<Signer | null> | null>(null);
  const providerRef = useRef<any>(null);
  const providerListenersAttachedRef = useRef(false);
  const handleAccountsChangedRef = useRef<(accounts: string[]) => void>(() => {});
  const handleDisconnectRef = useRef<() => void>(() => {});
  const wrappedFetchRef = useRef<typeof fetch>(fetch);

  const resetSigner = useCallback(() => {
    const provider = providerRef.current;
    if (provider && typeof provider.removeListener === "function" && providerListenersAttachedRef.current) {
      provider.removeListener("accountsChanged", handleAccountsChangedRef.current);
      provider.removeListener("disconnect", handleDisconnectRef.current);
      providerListenersAttachedRef.current = false;
    }

    providerRef.current = null;
    signerRef.current = null;
    signerPromiseRef.current = null;
    setWalletAddress(null);
    setUsdcBalance(null);
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);

    try {
      const [configRes, pricingRes] = await Promise.all([
        fetch("/api/x402/config").catch(() => null),
        fetch("/api/x402/pricing").catch(() => null),
      ]);

      if (configRes && configRes.ok) {
        setConfig(await configRes.json());
      } else {
        setConfig({ enabled: false });
      }

      if (pricingRes && pricingRes.ok) {
        setPricing(await pricingRes.json());
      } else {
        setPricing(null);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load x402 configuration",
      );
      setConfig({ enabled: false });
      setPricing(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  useEffect(() => {
    resetSigner();

    if (!config?.enabled) {
      return;
    }
  }, [config?.enabled, config?.network, resetSigner]);

  const getTargetChain = useCallback((): Chain => {
    const network = config?.network ?? "base-sepolia";
    switch (network) {
      case "base":
        return base;
      case "base-sepolia":
      default:
        return baseSepolia;
    }
  }, [config?.network]);

  // Helper function to check balance for a specific address
  const checkBalanceForAddress = useCallback(async (address: string, provider: any) => {
    setIsCheckingBalance(true);
    try {
      if (!provider) {
        console.error("[checkBalance] Provider not available");
        throw new Error("Provider not available");
      }

      const network = config?.network || "base-sepolia";

      // x402 uses USDC on Base (6 decimals)
      const tokenAddress =
        config?.usdcAddress && config.usdcAddress.length > 0
          ? config.usdcAddress
          : network === "base"
            ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const tokenDecimals = 6;

      // ERC20 balanceOf ABI
      const balanceOfAbi = "70a08231"; // balanceOf(address) - function selector
      const paddedAddress = address.slice(2).padStart(64, "0");
      const callData = `0x${balanceOfAbi}${paddedAddress}`;

      const balance = await provider.request({
        method: "eth_call",
        params: [
          {
            to: tokenAddress,
            data: callData,
          },
          "latest",
        ],
      });

      // Convert hex balance to decimal using correct decimals
      const balanceInWei = BigInt(balance as string);
      const divisor = BigInt(10 ** tokenDecimals);
      const balanceInToken = Number(balanceInWei) / Number(divisor);

      setUsdcBalance(balanceInToken.toFixed(2));
    } catch (err) {
      setUsdcBalance("0.00");
    } finally {
      setIsCheckingBalance(false);
    }
  }, [config]);

  const checkBalance = useCallback(async () => {
    if (!walletAddress || !providerRef.current) {
      return;
    }

    await checkBalanceForAddress(walletAddress, providerRef.current);
  }, [walletAddress, checkBalanceForAddress]);

  const connectWallet = useCallback(async () => {
    if (!config?.enabled) {
      throw new Error("x402 is not enabled; cannot connect wallet.");
    }

    setIsConnecting(true);
    setError(null);

    try {
      if (typeof window === "undefined") {
        throw new Error("Wallet connections are only available in the browser environment.");
      }

      // Check for browser wallet (MetaMask, Rainbow, etc.)
      if (!(window as any).ethereum) {
        throw new Error("No Ethereum wallet detected. Please install MetaMask or another wallet.");
      }

      const provider = (window as any).ethereum;
      providerRef.current = provider;

      const chain = getTargetChain();
      const rpcUrl = chain.rpcUrls.default.http?.[0];
      if (!rpcUrl) {
        throw new Error("Unable to determine RPC URL for configured network.");
      }

      // Request accounts
      let accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error("No wallet accounts returned by provider.");
      }

      const targetChainHex = `0x${chain.id.toString(16)}`;
      const currentChainHex = (await provider.request({
        method: "eth_chainId",
      })) as string | undefined;

      // Switch to correct network if needed
      if (
        !currentChainHex ||
        currentChainHex.toLowerCase() !== targetChainHex.toLowerCase()
      ) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetChainHex }],
          });
        } catch (switchError: any) {
          if (switchError?.code === 4902) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: targetChainHex,
                  chainName: chain.name,
                  nativeCurrency: chain.nativeCurrency,
                  rpcUrls: [rpcUrl],
                  blockExplorerUrls: chain.blockExplorers
                    ? [chain.blockExplorers.default.url]
                    : [],
                },
              ],
            });
          } else {
            throw switchError;
          }
        }

        accounts = (await provider.request({
          method: "eth_requestAccounts",
        })) as string[];
      }

      if (!accounts || accounts.length === 0) {
        throw new Error("No wallet accounts returned by provider.");
      }

      const account = accounts[0] as Address;
      setWalletAddress(account);

      const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(provider),
      }).extend(publicActions);

      signerRef.current = walletClient as unknown as Signer;
      signerPromiseRef.current = Promise.resolve(walletClient as unknown as Signer);

      // Create wrapped fetch with x402 payment capability
      // @ts-ignore - wrapFetchWithPayment types are compatible but TypeScript is overly strict
      wrappedFetchRef.current = wrapFetchWithPayment(fetch, walletClient as any);

      console.log("[useX402Payment] MetaMask wrapped fetch created:", {
        hasWrappedFetch: !!wrappedFetchRef.current,
        walletAddress: account,
        chain: chain.name,
      });

      // Show success toast
      toast.success(
        `✅ Wallet Connected!\n\nAddress: ${account.slice(0, 6)}...${account.slice(-4)}`,
        5000
      );

      // Check USDC balance immediately after connecting (use account directly, not state)
      setTimeout(async () => {
        await checkBalanceForAddress(account, provider);
      }, 500);

      if (typeof provider.on === "function" && !providerListenersAttachedRef.current) {
        handleAccountsChangedRef.current = (accounts: string[]) => {
          if (!accounts || accounts.length === 0) {
            resetSigner();
          } else {
            setWalletAddress(accounts[0] as Address);
            signerRef.current = walletClient as unknown as Signer;
            signerPromiseRef.current = Promise.resolve(walletClient as unknown as Signer);
          }
        };

        handleDisconnectRef.current = () => {
          resetSigner();
        };

        provider.on("accountsChanged", handleAccountsChangedRef.current);
        provider.on("disconnect", handleDisconnectRef.current);
        providerListenersAttachedRef.current = true;
      }
    } catch (err) {
      resetSigner();
      const errorMsg = err instanceof Error ? err.message : "Failed to connect wallet.";
      setError(errorMsg);
      
      // Show error toast
      toast.error(`❌ Wallet Connection Failed\n\n${errorMsg}`, 6000);
      
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [config?.enabled, getTargetChain, resetSigner, toast, checkBalanceForAddress]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (providerRef.current?.disconnect) {
        await providerRef.current.disconnect();
      }
    } catch {
      // ignore provider disconnect errors
    } finally {
      resetSigner();
      
      // Show disconnection toast
      toast.info("👋 Wallet Disconnected", 3000);
    }
  }, [resetSigner, toast]);

  useEffect(() => {
    if (walletAddress) {
      setError(null);
    }
  }, [walletAddress]);

  // Show toast when balance is checked and is insufficient
  useEffect(() => {
    if (usdcBalance !== null && !isCheckingBalance && walletAddress) {
      const balance = parseFloat(usdcBalance);
      if (balance < 0.10) {
        const network = config?.network || "base-sepolia";
        const isTestnet = network.includes("sepolia");

        toast.warning(
          `⚠️ Low USDC Balance\n\nYour balance is $${usdcBalance} USDC. You need at least $0.10 to make payments.\n\n${isTestnet ? "Get free testnet USDC from Circle Faucet!" : "Please fund your wallet."}`,
          8000
        );
      }
    }
  }, [usdcBalance, isCheckingBalance, walletAddress, config?.network, toast]);

  useEffect(() => () => {
    resetSigner();
  }, [resetSigner]);

  useEffect(() => {
    return () => {
      resetSigner();
    };
  }, [resetSigner]);

  const canSign =
    Boolean(config?.enabled) && Boolean(walletAddress) && !isConnecting;

  // Return wrapped fetch with payment or regular fetch
  const fetchWithPayment = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Re-evaluate canSign at call time to avoid stale closure
      const currentCanSign = Boolean(config?.enabled) && Boolean(walletAddress) && !isConnecting;
      const hasWrappedFetch = !!wrappedFetchRef.current;
      const shouldUseWrapped = currentCanSign && hasWrappedFetch;
      const actualFetch = shouldUseWrapped ? wrappedFetchRef.current : fetch;

      console.log("[useX402Payment] fetchWithPayment called:", {
        canSign: currentCanSign,
        configEnabled: config?.enabled,
        walletAddress,
        isConnecting,
        hasWrappedFetch,
        shouldUseWrapped,
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : "Request object",
      });

      if (!shouldUseWrapped) {
        console.warn("[useX402Payment] NOT using wrapped fetch - payment header will NOT be added!");
      }

      return actualFetch(input, init) as Promise<Response>;
    },
    [config?.enabled, walletAddress, isConnecting]
  );

  // Calculate if user has insufficient balance (less than $0.10 for example)
  const hasInsufficientBalance = usdcBalance !== null && parseFloat(usdcBalance) < 0.10;

  // Method to set embedded wallet client
  const setEmbeddedWalletClient = useCallback((client: any, address: string) => {
    if (!client || !address) {
      console.error("[useX402Payment] Invalid embedded wallet client or address");
      return;
    }

    // Set wallet address
    setWalletAddress(address as Address);

    // Set signer
    signerRef.current = client as unknown as Signer;
    signerPromiseRef.current = Promise.resolve(client as unknown as Signer);

    // Create wrapped fetch with x402 payment capability
    // @ts-ignore - wrapFetchWithPayment types are compatible but TypeScript is overly strict
    wrappedFetchRef.current = wrapFetchWithPayment(fetch, client as any);

    // Create an EIP-1193 provider shim for balance checking
    const providerShim = {
      request: async ({ method, params }: any) => {
        try {
          // Forward all requests to the client's transport
          return await client.transport.request({ method, params });
        } catch (error) {
          console.error("[useX402Payment] Provider shim error:", method, error);
          throw error;
        }
      },
    };

    providerRef.current = providerShim;

    // Check balance immediately after setting client
    setTimeout(async () => {
      await checkBalanceForAddress(address, providerShim);
    }, 500);
  }, [checkBalanceForAddress]);

  return {
    config,
    pricing,
    loading,
    enabled: Boolean(config?.enabled),
    canSign,
    walletAddress,
    isConnecting,
    error,
    usdcBalance,
    isCheckingBalance,
    hasInsufficientBalance,
    // Protocol info
    protocol: (config?.protocol || "x402") as PaymentProtocol,
    availableNetworks: config?.availableNetworks || [],
    // Methods
    refresh: fetchConfig,
    connectWallet,
    disconnectWallet,
    fetchWithPayment,
    decodePaymentResponse: decodeXPaymentResponse,
    checkBalance,
    setEmbeddedWalletClient,
  };
}
