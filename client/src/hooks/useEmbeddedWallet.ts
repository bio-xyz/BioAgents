import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useToast } from "./useToast";
import { useEmbeddedWalletClient } from "./useEmbeddedWalletClient";

// Lazy import CDP hooks to avoid context errors when provider is not mounted
let cdpHooksModule: typeof import("@coinbase/cdp-hooks") | null = null;

/**
 * Safe wrapper for CDP hooks that returns null values when CDP context is not available
 */
function useSafeCdpHooks(x402Enabled: boolean) {
  const [cdpState, setCdpState] = useState<{
    isSignedIn: boolean;
    evmAddress: string | null;
    signOut: (() => Promise<void>) | null;
  }>({
    isSignedIn: false,
    evmAddress: null,
    signOut: null,
  });

  useEffect(() => {
    if (!x402Enabled) {
      setCdpState({ isSignedIn: false, evmAddress: null, signOut: null });
      return;
    }

    // Dynamically import CDP hooks to avoid errors when provider is not mounted
    import("@coinbase/cdp-hooks").then((module) => {
      cdpHooksModule = module;
    });
  }, [x402Enabled]);

  return cdpState;
}

/**
 * Hook to manage embedded wallet integration with x402 payments
 *
 * This hook bridges the Coinbase embedded wallet SDK with the existing
 * x402 payment infrastructure.
 *
 * @param network - Optional network identifier
 * @param x402Enabled - Whether x402 is enabled (determines if CDP hooks are used)
 */
export function useEmbeddedWallet(network?: string, x402Enabled: boolean = true) {
  const toast = useToast();

  // These hooks are safe to call - they handle missing CDP context internally
  // by returning undefined/null values
  let isSignedIn = false;
  let evmAddress: string | null = null;
  let signOutFn: (() => Promise<void>) | null = null;

  // Only try to use CDP hooks if x402 is enabled
  // The CDPProvider is only mounted when x402 is enabled (see index.jsx)
  if (x402Enabled) {
    try {
      // These hooks require CDPReactProvider context
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const signedInResult = require("@coinbase/cdp-hooks").useIsSignedIn();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const addressResult = require("@coinbase/cdp-hooks").useEvmAddress();
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const signOutResult = require("@coinbase/cdp-hooks").useSignOut();

      isSignedIn = signedInResult?.isSignedIn ?? false;
      evmAddress = addressResult?.evmAddress ?? null;
      signOutFn = signOutResult?.signOut ?? null;
    } catch (err) {
      // CDP hooks failed - context not available
      console.debug("[useEmbeddedWallet] CDP hooks not available:", err);
    }
  }

  const walletClient = useEmbeddedWalletClient(network, x402Enabled);

  // Track if we've already shown the toast for this connection
  const hasShownToast = useRef(false);

  // Show success toast when wallet is connected (only once)
  useEffect(() => {
    if (isSignedIn && evmAddress && !hasShownToast.current) {
      toast.success(
        `✅ Embedded Wallet Connected!\n\nAddress: ${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`,
        5000
      );
      hasShownToast.current = true;
    } else if (!isSignedIn) {
      // Reset the flag when user signs out
      hasShownToast.current = false;
    }
  }, [isSignedIn, evmAddress]);

  const disconnectEmbeddedWallet = useCallback(async () => {
    if (!signOutFn) {
      console.warn("[useEmbeddedWallet] Sign out not available");
      return;
    }

    try {
      await signOutFn();
      toast.info("👋 Embedded Wallet Disconnected", 3000);
    } catch (err: any) {
      console.error("[useEmbeddedWallet] Sign out failed:", err);
      toast.error(`❌ Failed to disconnect: ${err?.message || "Unknown error"}`, 5000);
    }
  }, [signOutFn, toast]);

  return {
    isSignedIn,
    evmAddress,
    walletClient,
    disconnectEmbeddedWallet,
  };
}
