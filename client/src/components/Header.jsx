import { useState } from "preact/hooks";

export function Header({
  x402Enabled,
  isEmbeddedWalletConnected,
  embeddedWalletAddress,
  usdcBalance,
  onConnectWallet
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (!embeddedWalletAddress) return;

    try {
      await navigator.clipboard.writeText(embeddedWalletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="header">
      <div className="header-title">BioAgents</div>

      {x402Enabled && (
        <div className="header-wallet">
          {isEmbeddedWalletConnected && embeddedWalletAddress ? (
            <div className="wallet-connected">
              <div className="wallet-status-dot" />
              {usdcBalance && (
                <span className="wallet-balance">${usdcBalance} USDC</span>
              )}
              <button
                onClick={handleCopyAddress}
                className="wallet-address-btn"
                title={copied ? "Copied!" : "Click to copy address"}
              >
                <span className="wallet-address">
                  {embeddedWalletAddress.slice(0, 6)}...{embeddedWalletAddress.slice(-4)}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="copy-icon"
                >
                  {copied ? (
                    <path d="M20 6L9 17l-5-5" />
                  ) : (
                    <>
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </>
                  )}
                </svg>
              </button>
            </div>
          ) : (
            <button onClick={onConnectWallet} className="connect-wallet-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              Connect Wallet
            </button>
          )}
        </div>
      )}
    </div>
  );
}
