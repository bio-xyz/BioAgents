import { ComponentChildren } from "preact";
import { CDPReactProvider } from "@coinbase/cdp-react";

interface CDPProviderProps {
  children: ComponentChildren;
}

/**
 * CDP Provider wrapper for Preact compatibility
 *
 * This component wraps the Coinbase CDP React provider to work with Preact.
 * Preact has React compatibility built-in via preact/compat.
 */
export function CDPProvider({ children }: CDPProviderProps) {
  const projectId = import.meta.env.CDP_PROJECT_ID;

  if (!projectId || projectId === 'your-project-id-here') {
    console.warn(
      'CDP_PROJECT_ID not configured. Please set it in your .env file.\n' +
      'Get your project ID from https://portal.cdp.coinbase.com/products/embedded-wallets'
    );
    // Return children without CDP provider if not configured
    return <>{children}</>;
  }

  return (
    <CDPReactProvider
      config={{
        projectId,
        ethereum: {
          // Create an EOA (Externally Owned Account) on login
          // You can also use "smart" for smart contract wallets
          createOnLogin: "eoa"
        },
        // Enable Solana support if needed
        // solana: {
        //   createOnLogin: true
        // },
        appName: "BioAgents AgentKit"
      }}
    >
      {children}
    </CDPReactProvider>
  );
}
