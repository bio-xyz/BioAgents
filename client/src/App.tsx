import { useState, useEffect } from "preact/hooks";

import { ChatInput } from "./components/ChatInput";
import { ErrorMessage } from "./components/ErrorMessage";
import { Message } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { TypingIndicator } from "./components/TypingIndicator";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoginScreen } from "./components/LoginScreen";
import { ToastContainer } from "./components/Toast";
import { EmbeddedWalletAuth } from "./components/EmbeddedWalletAuth";
import { Modal } from "./components/ui/Modal";
import { PaymentConfirmationModal } from "./components/PaymentConfirmationModal";
import { ThinkingSteps } from "./components/ThinkingSteps";
import { StreamingResponse } from "./components/StreamingResponse";

// Custom hooks
import {
  useAutoScroll,
  useChatAPI,
  useFileUpload,
  useSessions,
  useAuth,
  useX402Payment,
  useToast,
  useEmbeddedWallet,
  useStates,
} from "./hooks";

// Utils
import { generateConversationId } from "./utils/helpers";

export function App() {
  // Toast notifications
  const toast = useToast();
  
  // Auth management
  const { isAuthenticated, isAuthRequired, isChecking, login } = useAuth();

  // x402 payment state (only if enabled)
  const x402 = useX402Payment();
  const {
    enabled: x402Enabled,
    walletAddress,
    error: x402Error,
    usdcBalance,
    hasInsufficientBalance,
    checkBalance,
    config: x402ConfigData,
  } = x402;

  // Embedded wallet state (only if x402 is enabled)
  const embeddedWallet = x402Enabled ? useEmbeddedWallet(x402ConfigData?.network) : null;
  const {
    isSignedIn: isEmbeddedWalletConnected,
    evmAddress: embeddedWalletAddress,
    walletClient: embeddedWalletClient,
  } = embeddedWallet || { isSignedIn: false, evmAddress: null, walletClient: null };

  // Get or create dev user ID (only used when x402 is disabled)
  const getDevUserId = () => {
    if (x402Enabled) return null; // Don't use dev user ID when x402 is enabled

    const stored = localStorage.getItem('dev_user_id');

    // Migration: If stored ID is old format (dev_user_*), clear it and generate new UUID
    if (stored && stored.startsWith('dev_user_')) {
      console.log('[App] Migrating old dev user ID to UUID format:', stored);
      localStorage.removeItem('dev_user_id');
      // Fall through to create new UUID
    } else if (stored) {
      return stored; // Valid UUID, use it
    }

    // Create a proper UUID for dev user (enables Supabase persistence)
    const newId = generateConversationId();
    localStorage.setItem('dev_user_id', newId);
    console.log('[App] Created new dev user ID (UUID):', newId);
    return newId;
  };

  const devUserId = getDevUserId();

  // Determine which user ID to use: embedded wallet (x402) or dev user ID
  const actualUserId = x402Enabled ? embeddedWalletAddress : devUserId;

  // Session management (pass the appropriate user ID)
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
  } = useSessions(actualUserId || undefined);

  // Real-time states for thinking visualization
  const {
    currentState,
    isLoading: isLoadingStates,
  } = useStates(userId, currentSessionId);

  // Chat API
  const {
    isLoading,
    error,
    paymentTxHash,
    sendMessage,
    sendDeepResearchMessage,
    clearError,
    pendingPayment,
    confirmPayment,
    cancelPayment,
  } = useChatAPI(x402);

  // File upload
  const { selectedFile, selectedFiles, selectFile, selectFiles, removeFile, clearFile } = useFileUpload();

  // Auto-scroll
  const { containerRef, scrollToBottom } = useAutoScroll([
    currentSession.messages,
  ]);

  // Input state
  const [inputValue, setInputValue] = useState("");

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Wallet modal state
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Store pending message data for after payment confirmation
  const [pendingMessageData, setPendingMessageData] = useState<{
    content: string;
    fileMetadata?: Array<{ name: string; size: number }>;
  } | null>(null);

  // Track which conversation is currently loading
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);

  // Track which message is currently loading (for matching with state updates)
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);

  const messages = currentSession.messages;

  // Check if the current conversation is the one that's loading
  const isCurrentConversationLoading = isLoading && loadingConversationId === currentSessionId;

  // Clear loading state when loading completes or conversation changes
  useEffect(() => {
    if (!isLoading && loadingConversationId) {
      setLoadingConversationId(null);
      setLoadingMessageId(null);
    }
  }, [isLoading, loadingConversationId]);

  // Clear loading message ID when switching conversations
  useEffect(() => {
    setLoadingMessageId(null);
  }, [currentSessionId]);

  // Watch for deep research completion
  useEffect(() => {
    if (!isCurrentConversationLoading || !currentState?.values) return;

    const { finalResponse, steps, isDeepResearch, messageId } = currentState.values;

    // Only handle deep research completions
    if (!isDeepResearch) return;

    // Only handle if this state matches the message we're waiting for
    if (messageId !== loadingMessageId) return;

    // Check if deep research is complete:
    // 1. finalResponse exists
    // 2. All steps are complete (have end timestamps)
    if (finalResponse && steps) {
      const allStepsComplete = Object.values(steps).every((step: any) => step.end);

      if (allStepsComplete) {
        console.log('[App] Deep research complete, finalizing message');

        // Check if we've already added this message
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage?.content === finalResponse) {
          console.log('[App] Message already added, skipping');
          return;
        }

        // Capture thinking state
        const capturedState = {
          steps: currentState.values.steps,
          source: currentState.values.source,
          thought: currentState.values.thought,
        };

        // Add final message
        addMessage({
          id: Date.now(),
          role: "assistant" as const,
          content: finalResponse,
          thinkingState: capturedState,
        });

        scrollToBottom();

        // Clear loading state
        setLoadingConversationId(null);
        setLoadingMessageId(null);
      }
    }
  }, [currentState, isCurrentConversationLoading, messages, loadingMessageId]);

  // Integrate embedded wallet with x402 payments (only if x402 is enabled)
  useEffect(() => {
    if (x402Enabled && isEmbeddedWalletConnected && embeddedWalletAddress && embeddedWalletClient) {
      x402.setEmbeddedWalletClient(embeddedWalletClient, embeddedWalletAddress);
    }
  }, [x402Enabled, isEmbeddedWalletConnected, embeddedWalletAddress, embeddedWalletClient]);

  // Fetch and attach all states to messages when conversation loads
  useEffect(() => {
    if (!currentSessionId || !userId) return;
    if (messages.length === 0) return;

    // Check if any assistant messages are missing thinking states
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const messagesNeedingStates = assistantMessages.filter(m => !m.thinkingState);

    if (messagesNeedingStates.length === 0) return;

    console.log('[App] Fetching states for', messagesNeedingStates.length, 'messages');

    // Fetch all states for this conversation
    async function fetchAndAttachStates() {
      try {
        const { getStatesByConversation } = await import('./lib/supabase');
        const states = await getStatesByConversation(currentSessionId);

        if (!states || states.length === 0) return;

        console.log('[App] Fetched', states.length, 'states for conversation');

        // Match states to messages (each state corresponds to one assistant response)
        // States are in chronological order, matching the order of assistant messages
        let stateIndex = 0;
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((msg) => {
            if (msg.role === 'assistant' && !msg.thinkingState && stateIndex < states.length) {
              const state = states[stateIndex];
              stateIndex++;

              if (state.values && state.values.steps) {
                console.log('[App] Attaching state to message:', msg.id);
                return {
                  ...msg,
                  thinkingState: {
                    steps: state.values.steps,
                    source: state.values.source,
                    thought: state.values.thought,
                  }
                };
              }
            }
            return msg;
          }),
        );
      } catch (err) {
        console.error('[App] Error fetching states:', err);
      }
    }

    fetchAndAttachStates();
  }, [currentSessionId, userId, messages.length]);

  /**
   * Handle sending a message
   */
  const handleSend = async (mode: string = 'normal') => {
    const trimmedInput = inputValue.trim();
    const hasFiles = selectedFiles.length > 0;

    console.log('[App.handleSend] Input:', trimmedInput);
    console.log('[App.handleSend] Selected files:', selectedFiles);
    console.log('[App.handleSend] Has files:', hasFiles);
    console.log('[App.handleSend] Mode:', mode);

    if ((!trimmedInput && !hasFiles) || isLoading) return;

    clearError();

    // Create display text for files
    const fileText = hasFiles
      ? selectedFiles.length === 1
        ? `[Attached: ${selectedFiles[0].name}]`
        : `[Attached ${selectedFiles.length} files]`
      : "";

    // Store file references before clearing state
    const filesToSend = [...selectedFiles];
    const messageContent = trimmedInput || fileText;
    const fileMetadata = hasFiles
      ? selectedFiles.map((f) => ({ name: f.name, size: f.size }))
      : undefined;

    // Store for use after payment confirmation
    setPendingMessageData({
      content: messageContent,
      fileMetadata,
    });

    // Clear input and files BEFORE sending to improve UX
    setInputValue("");
    clearFile();

    // Add user message to chat IMMEDIATELY (before API call)
    // This provides instant feedback to the user
    const userMessage = {
      id: Date.now(),
      role: "user" as const,
      content: messageContent,
      files: fileMetadata,
    };

    console.log('[App] Adding user message immediately, current messages.length:', messages.length);
    addMessage(userMessage);

    // Update session title if it's the first message
    const isFirstMessage = messages.length === 0;
    if (isFirstMessage) {
      const title = trimmedInput || (filesToSend[0]?.name) || "New conversation";
      console.log('[App] First message - updating session title:', title);
      updateSessionTitle(currentSessionId, title);
    }

    scrollToBottom();

    // Track which conversation is loading
    setLoadingConversationId(currentSessionId);

    try {
      // Route based on mode
      if (mode === 'deep') {
        // Deep research mode - call deep research endpoint
        const response = await sendDeepResearchMessage({
          message: trimmedInput,
          conversationId: currentSessionId,
          userId: userId,
          files: filesToSend,
          walletClient: x402Enabled ? embeddedWalletClient : null,
        });

        if (response.status === 'rejected') {
          // Validation failed - show error message from assistant
          addMessage({
            id: Date.now(),
            role: "assistant" as const,
            content: response.error || "Deep research request was rejected. Please check the format.",
          });
          scrollToBottom();
          // Clear loading state since we're done
          setLoadingConversationId(null);
          setLoadingMessageId(null);
        } else if (response.status === 'processing') {
          // Research started - the state will update in real-time via subscription
          // The StreamingResponse component will show the finalResponse as it streams
          // Keep loading state active - don't clear it yet
          console.log('[App] Deep research started, messageId:', response.messageId);

          // Store the message ID so we can match state updates to this specific message
          setLoadingMessageId(response.messageId);
        }

        // Clear pending message data
        setPendingMessageData(null);
      } else {
        // Normal mode - use regular sendMessage
        const response = await sendMessage({
          message: trimmedInput,
          conversationId: currentSessionId,
          userId: userId,
          files: filesToSend,
          walletClient: x402Enabled ? embeddedWalletClient : null,
        });

        // Only continue if we got a response (not empty from payment confirmation)
        if (response.text) {
          // Give a small delay for state to be fully updated via subscription
          await new Promise(resolve => setTimeout(resolve, 200));

          // Capture the current thinking state after delay
          const capturedState = currentState && currentState.values && currentState.values.steps
            ? {
                steps: currentState.values.steps,
                source: currentState.values.source,
                thought: currentState.values.thought,
              }
            : undefined;

          console.log('[App] Captured thinking state for message:', capturedState);

          // Use the streamed finalResponse if available, otherwise fall back to response.text
          const finalText = currentState?.values?.finalResponse || response.text;

          // Create final message directly (no animation needed since we showed it in real-time)
          addMessage({
            id: Date.now(),
            role: "assistant" as const,
            content: finalText,
            files: response.files,
            thinkingState: capturedState,
          });

          scrollToBottom();

          // Clear loading state to hide streaming component
          setLoadingConversationId(null);
          setLoadingMessageId(null);

          // Clear pending message data after successful send
          setPendingMessageData(null);
        } else {
          // If payment confirmation is needed, remove the user message we just added
          // since it will be added again after payment confirmation
          removeMessage(userMessage.id);
        }
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      // Don't show error for payment confirmation - modal is handling it
      if (err?.isPaymentConfirmation) {
        // Remove the user message since payment modal will re-add it
        removeMessage(userMessage.id);
        return;
      }
      // For other errors, remove the user message and restore the input so user can try again
      removeMessage(userMessage.id);
      setInputValue(trimmedInput);
      setPendingMessageData(null);

      // Clear loading state on error
      setLoadingConversationId(null);
      setLoadingMessageId(null);
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

        {x402Enabled && !isEmbeddedWalletConnected && (
          <div style={{ margin: "0.75rem 0", padding: "0 2rem" }}>
            <div style={{ padding: "0.75rem 1rem", background: "#0a0a0a", borderRadius: "12px", border: "1px solid #262626" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>
                    Connect Your Wallet
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#a1a1a1" }}>
                    Create a secure wallet to access paid features
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWalletModalOpen(true)}
                  style={{
                    background: "#10b981",
                    border: "none",
                    color: "#000000",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 6px 16px rgba(16, 185, 129, 0.4)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.3)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  Connect Wallet
                </button>
              </div>
            </div>
          </div>
        )}

        {x402Enabled && isEmbeddedWalletConnected && embeddedWalletAddress && (
          <div style={{ margin: "0.75rem 0", padding: "0 2rem" }}>
            <EmbeddedWalletAuth usdcBalance={usdcBalance} />
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
              {messages.length === 0 && !isCurrentConversationLoading && (
                <WelcomeScreen onExampleClick={(text) => {
                  // Just set the input value, let user send manually
                  setInputValue(text);
                }} />
              )}

              {messages.map((msg) => (
                <Message key={msg.id} message={msg} />
              ))}

              {/* Show live thinking steps only for current loading message */}
              {isCurrentConversationLoading &&
               currentState?.values?.conversationId === currentSessionId &&
               (loadingMessageId === null || currentState?.values?.messageId === loadingMessageId) &&
               currentState?.values?.steps &&
               Object.keys(currentState.values.steps).length > 0 && (
                <ThinkingSteps state={currentState.values} />
              )}

              {/* Show streaming response in real-time */}
              {isCurrentConversationLoading &&
               currentState?.values?.conversationId === currentSessionId &&
               (loadingMessageId === null || currentState?.values?.messageId === loadingMessageId) &&
               currentState.values.finalResponse && (
                <StreamingResponse finalResponse={currentState.values.finalResponse} />
              )}

              {isCurrentConversationLoading &&
               (!currentState?.values?.finalResponse ||
                currentState?.values?.conversationId !== currentSessionId ||
                (loadingMessageId !== null && currentState?.values?.messageId !== loadingMessageId)) &&
               <TypingIndicator />}
            </>
          )}
        </div>

        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isCurrentConversationLoading}
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

    {/* Wallet Connection Modal - Only show if x402 is enabled */}
    {x402Enabled && (
      <Modal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        maxWidth="550px"
      >
        <EmbeddedWalletAuth
          onWalletConnected={() => {
            setIsWalletModalOpen(false);
          }}
        />
      </Modal>
    )}

    {/* Payment Confirmation Modal */}
    {pendingPayment && (
      <PaymentConfirmationModal
        isOpen={!!pendingPayment}
        amount={pendingPayment.amount}
        currency={pendingPayment.currency}
        network={pendingPayment.network}
        onConfirm={async () => {
          if (!pendingMessageData) return;

          // Add user message to chat IMMEDIATELY after confirmation
          const userMessage = {
            id: Date.now(),
            role: "user" as const,
            content: pendingMessageData.content,
            files: pendingMessageData.fileMetadata,
          };

          addMessage(userMessage);

          // Update session title if it's the first message
          if (messages.length === 0) {
            const title = pendingMessageData.content || "New conversation";
            updateSessionTitle(currentSessionId, title);
          }

          // Let message animation complete and scroll
          setTimeout(() => scrollToBottom(), 50);

          // Now process the payment and get response
          const response = await confirmPayment();

          if (response && response.text) {
            // Give a small delay for state to be fully updated via subscription
            await new Promise(resolve => setTimeout(resolve, 200));

            // Capture the current thinking state after delay
            const capturedState = currentState && currentState.values && currentState.values.steps
              ? {
                  steps: currentState.values.steps,
                  source: currentState.values.source,
                  thought: currentState.values.thought,
                }
              : undefined;

            console.log('[App] Captured thinking state for payment message:', capturedState);

            // Use the streamed finalResponse if available, otherwise fall back to response.text
            const finalText = currentState?.values?.finalResponse || response.text;

            // Create final message directly (no animation needed since we showed it in real-time)
            addMessage({
              id: Date.now(),
              role: "assistant" as const,
              content: finalText,
              files: response.files,
              thinkingState: capturedState,
            });

            scrollToBottom();

            // Clear loading state to hide streaming component
            setLoadingConversationId(null);
            setLoadingMessageId(null);

            // Clear pending message data after successful send
            setPendingMessageData(null);
          }
        }}
        onCancel={() => {
          cancelPayment();
          setPendingMessageData(null);
        }}
      />
    )}
    </>
  );
}
