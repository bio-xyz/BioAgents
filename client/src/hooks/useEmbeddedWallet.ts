import { useCallback, useEffect, useRef } from "preact/hooks";
import { useIsSignedIn, useEvmAddress, useSignOut } from "@coinbase/cdp-hooks";
import { useToast } from "./useToast";
import { useEmbeddedWalletClient } from "./useEmbeddedWalletClient";

/**
 * Hook to manage embedded wallet integration with x402 payments
 *
 * This hook bridges the Coinbase embedded wallet SDK with the existing
 * x402 payment infrastructure.
 */
export function useEmbeddedWallet(network?: string) {
  const toast = useToast();
  const { isSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { signOut } = useSignOut();
  const walletClient = useEmbeddedWalletClient(network);

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
    try {
      await signOut();
      toast.info("👋 Embedded Wallet Disconnected", 3000);
    } catch (err: any) {
      console.error("[useEmbeddedWallet] Sign out failed:", err);
      toast.error(`❌ Failed to disconnect: ${err?.message || "Unknown error"}`, 5000);
    }
  }, [signOut, toast]);

  return {
    isSignedIn,
    evmAddress,
    walletClient,
    disconnectEmbeddedWallet,
  };
}
