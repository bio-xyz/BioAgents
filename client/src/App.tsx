import { useState } from "preact/hooks";

import { ChatInput } from "./components/ChatInput";
import { ErrorMessage } from "./components/ErrorMessage";
import { Message } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { TypingIndicator } from "./components/TypingIndicator";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoginScreen } from "./components/LoginScreen";
import { ToastContainer } from "./components/Toast";

// Custom hooks
import {
  useAutoScroll,
  useChatAPI,
  useFileUpload,
  useSessions,
  useTypingAnimation,
  useAuth,
  useX402Payment,
  useToast,
} from "./hooks";

export function App() {
  // Toast notifications
  const toast = useToast();
  
  // Auth management
  const { isAuthenticated, isAuthRequired, isChecking, login } = useAuth();

  // Session management
  const {
    sessions,
    currentSession,
    currentSessionId,
    userId,
    isLoading: isLoadingSessions,
    addMessage,
    removeMessage,
    updateSessionMessages,
    updateSessionTitle,
    createNewSession,
    deleteSession,
    switchSession,
  } = useSessions();

  // x402 payment state
  const x402 = useX402Payment();
  const {
    enabled: x402Enabled,
    walletAddress,
    isConnecting: isWalletConnecting,
    connectWallet,
    disconnectWallet,
    error: x402Error,
    usdcBalance,
    isCheckingBalance,
    hasInsufficientBalance,
    checkBalance,
    config: x402ConfigData,
  } = x402;

  // Chat API
  const {
    isLoading,
    error,
    paymentTxHash,
    sendMessage,
    clearError,
  } = useChatAPI(x402);

  // File upload
  const { selectedFile, selectedFiles, selectFile, selectFiles, removeFile, clearFile } = useFileUpload();

  // Typing animation
  const { isTyping, animateText } = useTypingAnimation();

  // Auto-scroll
  const { containerRef, scrollToBottom } = useAutoScroll([
    currentSession.messages,
    isTyping,
  ]);

  // Input state
  const [inputValue, setInputValue] = useState("");

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const messages = currentSession.messages;

  /**
   * Handle sending a message
   */
  const handleSend = async () => {
    const trimmedInput = inputValue.trim();
    const hasFiles = selectedFiles.length > 0;

    console.log('[App.handleSend] Input:', trimmedInput);
    console.log('[App.handleSend] Selected files:', selectedFiles);
    console.log('[App.handleSend] Has files:', hasFiles);

    if ((!trimmedInput && !hasFiles) || isLoading) return;

    clearError();

    // Create display text for files
    const fileText = hasFiles
      ? selectedFiles.length === 1
        ? `[Attached: ${selectedFiles[0].name}]`
        : `[Attached ${selectedFiles.length} files]`
      : "";

    // Create user message
    const userMessage = {
      id: Date.now(),
      role: "user" as const,
      content: trimmedInput || fileText,
      files: hasFiles
        ? selectedFiles.map((f) => ({ name: f.name, size: f.size }))
        : undefined,
    };

    addMessage(userMessage);

    // Update session title if it's the first message
    if (messages.length === 0) {
      const title = trimmedInput || selectedFiles[0]?.name || "New conversation";
      updateSessionTitle(currentSessionId, title);
    }

    // Store file references before clearing state
    const filesToSend = [...selectedFiles];

    // Clear input and files
    setInputValue("");
    clearFile();
    scrollToBottom();

    try {
      // Send message to API
      const response = await sendMessage({
        message: trimmedInput,
        conversationId: currentSessionId,
        userId: userId,
        files: filesToSend,
      });

      // Create temp message for typing animation
      const tempId = Date.now();
      addMessage({
        id: tempId,
        role: "assistant" as const,
        content: "",
        files: response.files, // Include file metadata from response
      });

      // Animate the response
      await animateText(
        response.text,
        (currentText) => {
          updateSessionMessages(currentSessionId, (prev) =>
            prev.map((msg) =>
              msg.id === tempId
                ? { ...msg, content: currentText, files: response.files }
                : msg,
            ),
          );
          scrollToBottom();
        },
        () => {
          scrollToBottom();
        },
      );
    } catch (err: any) {
      console.error("Chat error:", err);
      if (err?.isPaymentRequired) {
        // Keep the original message so the user can retry after payment
        return;
      }
      // Remove user message on non-payment errors
      removeMessage(userMessage.id);
    }
  };

  // Show loading screen while checking auth
  if (isChecking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary)',
        color: 'var(--text-secondary)'
      }}>
        Loading...
      </div>
    );
  }

  // Show login screen if auth is required and user is not authenticated
  if (isAuthRequired && !isAuthenticated) {
    return <LoginScreen onLogin={login} />;
  }

  // Show main app
  return (
    <>
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
      <div className="app">
      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={(id) => {
          switchSession(id);
          setIsMobileSidebarOpen(false);
        }}
        onNewSession={() => {
          createNewSession();
          setIsMobileSidebarOpen(false);
        }}
        onDeleteSession={deleteSession}
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
      />

      <div className="main-content">
        {/* Mobile menu button */}
        <button
          className="mobile-menu-btn"
          onClick={() => setIsMobileSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        {x402Enabled && (
          <div
            style={{
              margin: "0.75rem 0 1rem 0",
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              background: "rgba(15, 23, 42, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            {walletAddress ? (
              <>
                <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Wallet: <strong style={{ color: "var(--text-primary)" }}>
                      {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                    </strong>
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Balance: {isCheckingBalance ? (
                      <span>Checking...</span>
                    ) : (
                      <strong style={{ color: hasInsufficientBalance ? "#ef4444" : "#16a34a" }}>
                        ${usdcBalance || "0.00"} USDC
                      </strong>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      navigator.clipboard.writeText(walletAddress);
                      const btn = e.currentTarget as HTMLButtonElement;
                      const originalText = btn.textContent;
                      btn.textContent = "Copied!";
                      setTimeout(() => {
                        btn.textContent = originalText || "Copy";
                      }, 2000);
                    }}
                    style={{
                      background: "var(--accent-light)",
                      border: "1px solid var(--accent-color)",
                      color: "var(--accent-color)",
                      padding: "0.3rem 0.7rem",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                    }}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => void disconnectWallet()}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(15, 23, 42, 0.4)",
                      color: "var(--text-primary)",
                      padding: "0.3rem 0.7rem",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", flex: "1" }}>
                  Connect your wallet to authorize paid requests.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void connectWallet().catch((err) =>
                      console.error("Wallet connection failed", err),
                    )
                  }
                  disabled={isWalletConnecting}
                  style={{
                    background: "#0052ff",
                    border: "none",
                    color: "white",
                    padding: "0.4rem 0.9rem",
                    borderRadius: "0.5rem",
                    cursor: isWalletConnecting ? "progress" : "pointer",
                    opacity: isWalletConnecting ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isWalletConnecting ? "Connecting…" : "Connect Wallet"}
                </button>
              </>
            )}
          </div>
        )}

        {x402Enabled && x402Error && (
          <div
            style={{
              marginBottom: "1rem",
              color: "#b91c1c",
              fontSize: "0.85rem",
            }}
          >
            {x402Error}
          </div>
        )}

        {x402Enabled && walletAddress && hasInsufficientBalance && (
          <div
            style={{
              margin: "0.75rem 0",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(251, 146, 60, 0.15)",
              border: "1px solid rgba(251, 146, 60, 0.35)",
              color: "var(--text-primary)",
            }}
            role="alert"
          >
            <strong style={{ display: "block", marginBottom: "0.25rem", color: "#ea580c" }}>
              ⚠️ Insufficient USDC Balance
            </strong>
            <span style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              You need at least $0.10 USDC to make payments. Your current balance is ${usdcBalance || "0.00"} USDC.
            </span>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {x402ConfigData?.network === "base-sepolia" ? (
                <>
                  <strong>Get free testnet USDC:</strong>
                  <ul style={{ marginTop: "0.25rem", marginLeft: "1.25rem", marginBottom: 0 }}>
                    <li>
                      <a
                        href="https://faucet.circle.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0052ff", textDecoration: "underline" }}
                      >
                        Circle Faucet
                      </a>
                      {" "}(10 USDC/hour on Base Sepolia)
                    </li>
                    <li>
                      <a
                        href={`https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0052ff", textDecoration: "underline" }}
                      >
                        Coinbase Faucet
                      </a>
                      {" "}(for Base Sepolia ETH, then swap)
                    </li>
                  </ul>
                </>
              ) : (
                <>
                  <strong>Get USDC on Base:</strong>
                  <ul style={{ marginTop: "0.25rem", marginLeft: "1.25rem", marginBottom: 0 }}>
                    <li>
                      <a
                        href="https://www.coinbase.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0052ff", textDecoration: "underline" }}
                      >
                        Buy on Coinbase
                      </a>
                      {" "}and bridge to Base
                    </li>
                    <li>
                      <a
                        href="https://app.uniswap.org"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0052ff", textDecoration: "underline" }}
                      >
                        Swap on Uniswap
                      </a>
                      {" "}(Base network)
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {paymentTxHash && (
          <div
            style={{
              margin: "0.75rem 0",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(34, 197, 94, 0.15)",
              border: "1px solid rgba(34, 197, 94, 0.35)",
              color: "var(--text-primary)",
            }}
            role="alert"
          >
            <strong style={{ display: "block", marginBottom: "0.25rem", color: "#16a34a" }}>
              ✓ Payment Successful
            </strong>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                wordBreak: "break-all",
              }}
            >
              <div>
                <strong>Transaction:</strong>{" "}
                <a
                  href={`https://sepolia.basescan.org/tx/${paymentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0052ff", textDecoration: "underline" }}
                >
                  {paymentTxHash.slice(0, 10)}...{paymentTxHash.slice(-8)}
                </a>
              </div>
            </div>
          </div>
        )}

        {error && (
          <ErrorMessage message={error} onClose={clearError} />
        )}

        <div className="chat-container" ref={containerRef}>
          {isLoadingSessions ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
              Loading conversations...
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <WelcomeScreen onExampleClick={(text) => setInputValue(text)} />
              )}

              {messages.map((msg) => (
                <Message key={msg.id} message={msg} />
              ))}

              {isLoading && !isTyping && <TypingIndicator />}
            </>
          )}
        </div>

        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isLoading}
          placeholder="Type your message..."
          selectedFile={selectedFile}
          selectedFiles={selectedFiles}
          onFileSelect={(fileOrFiles: File | File[]) => {
            if (Array.isArray(fileOrFiles)) {
              selectFiles(fileOrFiles);
            } else {
              selectFile(fileOrFiles);
            }
          }}
          onFileRemove={removeFile}
        />
      </div>
    </div>
    </>
  );
}
