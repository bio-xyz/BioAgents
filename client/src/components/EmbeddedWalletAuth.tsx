import { useState } from "preact/hooks";
import { useIsSignedIn } from "@coinbase/cdp-hooks";
import { useSignInWithEmail } from "@coinbase/cdp-hooks";
import { useVerifyEmailOTP } from "@coinbase/cdp-hooks";
import { useEvmAddress } from "@coinbase/cdp-hooks";
import { useSignOut } from "@coinbase/cdp-hooks";

interface EmbeddedWalletAuthProps {
  onWalletConnected?: (address: string) => void;
  usdcBalance?: string;
}

export function EmbeddedWalletAuth({ onWalletConnected, usdcBalance }: EmbeddedWalletAuthProps) {
  const { isSignedIn } = useIsSignedIn();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signOut } = useSignOut();
  const { evmAddress } = useEvmAddress();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleEmailSubmit = async (e: Event) => {
    e.preventDefault();
    if (!email || isSigningIn) return;

    setError(null);
    setIsSigningIn(true);
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
    } catch (err: any) {
      console.error("Sign in failed:", err);
      setError(err?.message || "Failed to send verification code. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleOtpSubmit = async (e: Event) => {
    e.preventDefault();
    if (!flowId || !otp || isVerifying) return;

    setError(null);
    setIsVerifying(true);
    try {
      const { user } = await verifyEmailOTP({ flowId, otp });
      console.log("Signed in!", user);

      const address = user.evmAccounts?.[0];
      if (address && onWalletConnected) {
        onWalletConnected(address);
      }

      setFlowId(null);
      setOtp("");
      setEmail("");
    } catch (err: any) {
      console.error("OTP verification failed:", err);
      setError(err?.message || "Invalid verification code. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setFlowId(null);
      setOtp("");
      setEmail("");
      setError(null);
    } catch (err: any) {
      console.error("Sign out failed:", err);
      setError(err?.message || "Failed to sign out.");
    }
  };

  const handleBack = () => {
    setFlowId(null);
    setOtp("");
    setError(null);
  };

  const handleCopyAddress = () => {
    if (!evmAddress) return;
    navigator.clipboard.writeText(evmAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Connected State - Show wallet info
  if (isSignedIn && evmAddress) {
    return (
      <div
        style={{
          background: "rgba(16, 185, 129, 0.08)",
          borderRadius: "12px",
          padding: "12px 16px",
          border: "1px solid rgba(16, 185, 129, 0.2)",
          animation: "slideIn 0.3s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          {/* Status and Address */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#10b981",
                boxShadow: "0 0 8px rgba(16, 185, 129, 0.8)",
                animation: "pulse 2s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                <span style={{ fontSize: "12px", color: "#a1a1a1" }}>
                  Wallet Connected
                </span>
                {usdcBalance && (
                  <span style={{
                    fontSize: "12px",
                    color: "#10b981",
                    fontWeight: 700,
                    padding: "2px 8px",
                    background: "rgba(16, 185, 129, 0.1)",
                    borderRadius: "4px",
                    border: "1px solid rgba(16, 185, 129, 0.2)"
                  }}>
                    ${usdcBalance} USDC
                  </span>
                )}
              </div>
              <div style={{ fontSize: "14px", color: "#ffffff", fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                {evmAddress.slice(0, 8)}...{evmAddress.slice(-6)}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleCopyAddress}
              style={{
                background: copied ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                color: "#10b981",
                padding: "6px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              onMouseOver={(e) => {
                if (!copied) {
                  e.currentTarget.style.background = "rgba(16, 185, 129, 0.15)";
                }
              }}
              onMouseOut={(e) => {
                if (!copied) {
                  e.currentTarget.style.background = "rgba(16, 185, 129, 0.1)";
                }
              }}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#a1a1a1",
                padding: "6px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.color = "#a1a1a1";
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}</style>
      </div>
    );
  }

  // OTP Verification State
  if (flowId) {
    return (
      <div
        style={{
          background: "#0a0a0a",
          borderRadius: "16px",
          padding: "32px",
          border: "1px solid #262626",
          animation: "slideIn 0.3s ease-out",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
              <polyline points="22,6 12,13 2,6"></polyline>
            </svg>
          </div>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "#ffffff", fontWeight: 700 }}>
            Check Your Email
          </h3>
          <p style={{ margin: "0 0 4px 0", fontSize: "14px", color: "#a1a1a1", lineHeight: "1.5" }}>
            We sent a 6-digit verification code to
          </p>
          <p style={{ margin: 0, fontSize: "14px", color: "#10b981", fontWeight: 600 }}>
            {email}
          </p>
        </div>

        <form onSubmit={handleOtpSubmit}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#707070", marginBottom: "8px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
              Verification Code
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp((e.target as HTMLInputElement).value)}
              placeholder="000000"
              maxLength={6}
              autoFocus
              disabled={isVerifying}
              style={{
                width: "100%",
                padding: "16px",
                borderRadius: "12px",
                border: otp.length === 6 ? "2px solid #10b981" : "2px solid #262626",
                fontSize: "20px",
                fontWeight: 700,
                fontFamily: "monospace",
                textAlign: "center",
                letterSpacing: "8px",
                background: "#141414",
                color: "#ffffff",
                outline: "none",
                transition: "all 0.2s ease",
                boxShadow: otp.length === 6 ? "0 0 0 4px rgba(16, 185, 129, 0.1)" : "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#10b981";
              }}
              onBlur={(e) => {
                if (otp.length !== 6) {
                  e.currentTarget.style.borderColor = "#262626";
                }
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#ef4444",
                fontSize: "13px",
                marginBottom: "20px",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                animation: "slideIn 0.2s ease-out",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="button"
              onClick={handleBack}
              disabled={isVerifying}
              style={{
                flex: "1",
                padding: "14px 20px",
                borderRadius: "10px",
                border: "1px solid #262626",
                background: "#141414",
                color: "#a1a1a1",
                cursor: isVerifying ? "not-allowed" : "pointer",
                opacity: isVerifying ? 0.5 : 1,
                fontSize: "14px",
                fontWeight: 600,
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                if (!isVerifying) {
                  e.currentTarget.style.background = "#1a1a1a";
                  e.currentTarget.style.color = "#ffffff";
                }
              }}
              onMouseOut={(e) => {
                if (!isVerifying) {
                  e.currentTarget.style.background = "#141414";
                  e.currentTarget.style.color = "#a1a1a1";
                }
              }}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isVerifying || !otp || otp.length !== 6}
              style={{
                flex: "2",
                padding: "14px 20px",
                borderRadius: "10px",
                border: "none",
                background: isVerifying || !otp || otp.length !== 6
                  ? "#262626"
                  : "#10b981",
                color: isVerifying || !otp || otp.length !== 6 ? "#707070" : "#000000",
                cursor: isVerifying || !otp || otp.length !== 6 ? "not-allowed" : "pointer",
                fontSize: "14px",
                fontWeight: 700,
                transition: "all 0.2s ease",
                boxShadow: isVerifying || !otp || otp.length !== 6
                  ? "none"
                  : "0 4px 16px rgba(16, 185, 129, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              onMouseOver={(e) => {
                if (!isVerifying && otp && otp.length === 6) {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)";
                }
              }}
              onMouseOut={(e) => {
                if (!isVerifying && otp && otp.length === 6) {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(16, 185, 129, 0.3)";
                }
              }}
            >
              {isVerifying && (
                <div
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid rgba(0, 0, 0, 0.3)",
                    borderTopColor: "#000000",
                    borderRadius: "50%",
                    animation: "spin 0.6s linear infinite",
                  }}
                />
              )}
              {isVerifying ? "Verifying..." : "Verify Code"}
            </button>
          </div>
        </form>

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  // Email Input State - Initial onboarding
  return (
    <div
      style={{
        background: "#0a0a0a",
        borderRadius: "16px",
        padding: "32px",
        border: "1px solid #262626",
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "26px", color: "#ffffff", fontWeight: 700, letterSpacing: "-0.5px" }}>
          Welcome to BioAgents
        </h3>
        <p style={{ margin: "0 0 4px 0", fontSize: "14px", color: "#a1a1a1", lineHeight: "1.6" }}>
          Create your secure wallet with just your email
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "#707070" }}>
          No extensions • No seed phrases • 100% self-custodial
        </p>
      </div>

      <form onSubmit={handleEmailSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#707070", marginBottom: "8px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            placeholder="you@example.com"
            required
            disabled={isSigningIn}
            autoFocus
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: "10px",
              border: "2px solid #262626",
              fontSize: "15px",
              background: "#141414",
              color: "#ffffff",
              outline: "none",
              transition: "all 0.2s ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.boxShadow = "0 0 0 4px rgba(16, 185, 129, 0.1)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#262626";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "10px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              fontSize: "13px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              animation: "slideIn 0.2s ease-out",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}>
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSigningIn || !email}
          style={{
            width: "100%",
            padding: "14px 20px",
            borderRadius: "10px",
            border: "none",
            background: isSigningIn || !email ? "#262626" : "#10b981",
            color: isSigningIn || !email ? "#707070" : "#000000",
            cursor: isSigningIn || !email ? "not-allowed" : "pointer",
            fontSize: "15px",
            fontWeight: 700,
            transition: "all 0.2s ease",
            boxShadow: isSigningIn || !email ? "none" : "0 4px 16px rgba(16, 185, 129, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
          }}
          onMouseOver={(e) => {
            if (!isSigningIn && email) {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)";
            }
          }}
          onMouseOut={(e) => {
            if (!isSigningIn && email) {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(16, 185, 129, 0.3)";
            }
          }}
        >
          {isSigningIn && (
            <div
              style={{
                width: "18px",
                height: "18px",
                border: "2px solid rgba(0, 0, 0, 0.3)",
                borderTopColor: "#000000",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              }}
            />
          )}
          {isSigningIn ? "Sending Code..." : "Continue with Email"}
          {!isSigningIn && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          )}
        </button>
      </form>

      <div style={{ marginTop: "24px", padding: "16px", background: "rgba(16, 185, 129, 0.05)", borderRadius: "12px", border: "1px solid rgba(16, 185, 129, 0.1)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: "2px",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>
              Secure & Self-Custodial
            </p>
            <p style={{ margin: 0, fontSize: "12px", color: "#a1a1a1", lineHeight: "1.5" }}>
              Your wallet is secured by your email. Only you have access to your funds. We never store your private keys.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
