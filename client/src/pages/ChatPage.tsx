import { useCallback, useEffect, useState, useRef } from "preact/hooks";
import { route } from "preact-router";

import { ChatInput } from "../components/ChatInput";
import { ErrorMessage } from "../components/ErrorMessage";
import { Message } from "../components/Message";
import { ResearchStatePanel } from "../components/research";
import { Sidebar } from "../components/Sidebar";
import { ToastContainer } from "../components/Toast";
import { TypingIndicator } from "../components/TypingIndicator";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { ConversationProvider } from "../providers/ConversationProvider";

// Custom hooks
import {
  useAuth,
  useAutoScroll,
  useChatAPI,
  useFileUpload,
  usePresignedUpload,
  useSessions,
  useStates,
  useToast,
  useWebSocket,
} from "../hooks";
import { getMessagesByConversation } from "../lib/supabase";

// Utils
import { generateConversationId } from "../utils/helpers";

interface ChatPageProps {
  path?: string;
  sessionId?: string;
}

/**
 * Main chat page component
 * Handles conversation display, messaging, and research state
 */
export function ChatPage({ sessionId: urlSessionId }: ChatPageProps) {
  // Toast notifications
  const toast = useToast();

  // Auth context - provides userId from JWT
  const { userId: authUserId } = useAuth();

  // Fallback user ID for when auth is not required
  // Uses localStorage to persist across sessions
  const getFallbackUserId = () => {
    const stored = localStorage.getItem("dev_user_id");
    if (stored) return stored;
    const newId = generateConversationId();
    localStorage.setItem("dev_user_id", newId);
    return newId;
  };

  // Determine which user ID to use
  const actualUserId = authUserId || getFallbackUserId();

  // WebSocket connection state
  const [wsConnected, setWsConnected] = useState(false);

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
    refetchMessages,
  } = useSessions(actualUserId || undefined, wsConnected);

  // Track if we've already created a fresh session for /chat route
  const [freshSessionCreated, setFreshSessionCreated] = useState(false);

  // Reset fresh session flag when URL changes
  useEffect(() => {
    if (urlSessionId) {
      setFreshSessionCreated(false);
    }
  }, [urlSessionId]);

  // Sync session state with URL
  useEffect(() => {
    // Wait for sessions to finish loading
    if (isLoadingSessions) return;

    if (urlSessionId) {
      // URL has a session ID - try to load it
      const sessionExists = sessions.some(s => s.id === urlSessionId);

      if (sessionExists && urlSessionId !== currentSessionId) {
        console.log("[ChatPage] Switching to URL session:", urlSessionId);
        switchSession(urlSessionId);
      } else if (!sessionExists) {
        // Session doesn't exist - redirect to /chat
        console.log("[ChatPage] URL session not found, redirecting to /chat");
        route(`/chat`, true);
      }
    } else if (!freshSessionCreated) {
      // No URL session ID (/chat route) - ensure we have a fresh empty session
      // Check if current session has messages - if so, create new one
      const currentHasMessages = currentSession?.messages?.length > 0;
      if (currentHasMessages) {
        console.log("[ChatPage] At /chat with messages in current session, creating new session");
        createNewSession();
        setFreshSessionCreated(true);
      }
    }
  }, [urlSessionId, sessions, isLoadingSessions, freshSessionCreated]);

  // Real-time states for thinking visualization and research state
  const {
    currentState,
    conversationState,
    refetchConversationState,
  } = useStates(userId, currentSessionId);

  // Track processed message IDs to prevent duplicates (ref persists across renders)
  const processedMessageIds = useRef<Set<string>>(new Set());

  // Ref for currentSessionId to avoid stale closures in callbacks
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Ref for messages to avoid stale closures
  const messagesRef = useRef(currentSession.messages);
  useEffect(() => {
    messagesRef.current = currentSession.messages;
  }, [currentSession.messages]);

  /**
   * Atomically check if message was already processed and mark it if not.
   * Returns true if we should add the message (not yet processed).
   * Returns false if message was already processed (skip adding).
   */
  const tryMarkAsProcessed = useCallback((messageId: string | undefined, content?: string): boolean => {
    if (!messageId) return true; // No ID to track, allow adding

    // Check if already processed
    if (processedMessageIds.current.has(messageId)) {
      console.log(`[ChatPage] Message already processed (by ID): ${messageId}`);
      return false;
    }

    // Check if content already in UI (using ref for fresh data)
    if (content) {
      const existsInUI = messagesRef.current.some(
        (m: any) => m.dbMessageId === messageId || m.content === content
      );
      if (existsInUI) {
        console.log(`[ChatPage] Message already in UI: ${messageId}`);
        processedMessageIds.current.add(messageId); // Mark to prevent future attempts
        return false;
      }
    }

    // Mark as processed IMMEDIATELY (atomic with check)
    processedMessageIds.current.add(messageId);
    return true;
  }, []);

  // Clear processed messages when switching conversations
  useEffect(() => {
    processedMessageIds.current.clear();
  }, [currentSessionId]);

  // WebSocket message handler (backup for when polling doesn't catch it)
  const handleMessageUpdated = useCallback(async (messageId: string, conversationId: string) => {
    // Use ref to get latest currentSessionId (avoid stale closure)
    if (conversationId !== currentSessionIdRef.current) return;

    try {
      const dbMessages = await getMessagesByConversation(conversationId);
      const updatedMsg = dbMessages.find((m: any) => m.id === messageId);

      if (updatedMsg?.content) {
        // Atomic check-and-mark to prevent duplicates
        if (tryMarkAsProcessed(messageId, updatedMsg.content)) {
          addMessage({
            id: Date.now(),
            dbMessageId: messageId,
            role: "assistant" as const,
            content: updatedMsg.content,
            timestamp: new Date(),
          });
        }

        // Clear all loading states
        setIsDeepResearch(false);
        setLoadingConversationId(null);
        setLoadingMessageId(null);
      }
    } catch (err) {
      console.error("[ChatPage] WebSocket handler error:", err);
    }
  }, [addMessage, tryMarkAsProcessed]);

  // WebSocket state handler
  const handleStateUpdated = useCallback(async (_stateId: string, conversationId: string) => {
    if (conversationId !== currentSessionIdRef.current) return;
    console.log("[ChatPage] WebSocket: State updated, triggering refetch");
    await refetchConversationState();
  }, [refetchConversationState]); // Using ref for currentSessionId

  // WebSocket for real-time notifications
  const { isConnected: wsIsConnected, subscribe: wsSubscribe, unsubscribe: wsUnsubscribe } = useWebSocket(
    userId,
    handleMessageUpdated,
    handleStateUpdated,
  );

  // Sync WebSocket connection state
  useEffect(() => {
    setWsConnected(wsIsConnected);
  }, [wsIsConnected]);

  // Subscribe to current conversation via WebSocket
  useEffect(() => {
    if (currentSessionId && wsConnected) {
      wsSubscribe(currentSessionId);
      return () => wsUnsubscribe(currentSessionId);
    }
  }, [currentSessionId, wsConnected, wsSubscribe, wsUnsubscribe]);

  // Chat API
  const {
    isLoading,
    error,
    sendMessage,
    sendDeepResearchMessage,
    clearError,
    clearLoading,
  } = useChatAPI();

  // File upload
  const {
    selectedFile,
    selectedFiles,
    selectFile,
    selectFiles,
    removeFile,
    clearFile,
  } = useFileUpload();

  // Presigned S3 upload
  const {
    isUploading,
    uploadFiles: uploadToS3,
    clearUploadedFiles,
  } = usePresignedUpload();

  // Auto-scroll
  const { containerRef, scrollToBottom } = useAutoScroll([
    currentSession.messages,
  ]);

  // Input state
  const [inputValue, setInputValue] = useState("");

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Loading state tracking
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [isDeepResearch, setIsDeepResearch] = useState(false);

  // Research state panel visibility
  const [isResearchPanelExpanded, setIsResearchPanelExpanded] = useState(false);

  // Conversation mode tracking (per conversation)
  const [conversationModes, setConversationModes] = useState<Record<string, "normal" | "deep">>({});

  const messages = currentSession.messages;

  // Extract research state from conversation state
  const researchState = conversationState?.values
    ? {
        plan: conversationState.values.plan,
        discoveries: conversationState.values.discoveries,
        keyInsights: conversationState.values.keyInsights,
        methodology: conversationState.values.methodology,
        currentObjective: conversationState.values.currentObjective,
        uploadedDatasets: conversationState.values.uploadedDatasets,
        currentHypothesis: conversationState.values.currentHypothesis,
        suggestedNextSteps: conversationState.values.suggestedNextSteps,
      }
    : currentState?.values
      ? {
          plan: currentState.values.plan,
          discoveries: currentState.values.discoveries,
          keyInsights: currentState.values.keyInsights,
          methodology: currentState.values.methodology,
          currentObjective: currentState.values.currentObjective,
          uploadedDatasets: currentState.values.uploadedDatasets,
          currentHypothesis: currentState.values.currentHypothesis,
          suggestedNextSteps: currentState.values.suggestedNextSteps,
        }
      : null;

  // Check for active deep research session (has hypothesis, plan, or next steps)
  const hasActiveDeepResearch =
    researchState &&
    messages.length > 0 &&
    (researchState.currentHypothesis ||
      researchState.plan?.length > 0 ||
      researchState.suggestedNextSteps?.length > 0);

  // Check if there's any research state worth showing (for normal chat too)
  const hasAnyResearchState =
    researchState &&
    messages.length > 0 &&
    (researchState.uploadedDatasets?.length > 0 ||
      researchState.keyInsights?.length > 0 ||
      researchState.discoveries?.length > 0 ||
      researchState.currentHypothesis ||
      researchState.plan?.length > 0 ||
      researchState.suggestedNextSteps?.length > 0 ||
      researchState.methodology ||
      researchState.currentObjective);

  // Detect conversation mode from research state (for existing conversations)
  // If conversation has messages but no research state, it's a normal chat
  // If it has research state, it's deep research
  // If no messages yet, return undefined (new conversation)
  const detectedMode: "normal" | "deep" | undefined =
    messages.length === 0
      ? undefined  // New conversation - let user choose
      : hasActiveDeepResearch
        ? "deep"   // Has research state - deep research
        : "normal"; // Has messages but no research - normal chat

  // Get current conversation mode (explicit > detected > default to deep for new)
  const currentConversationMode = conversationModes[currentSessionId] || detectedMode;

  // Show research panel when deep research is in progress OR has any research state (including normal chat)
  const showResearchPanel = isDeepResearch || hasAnyResearchState;

  // Check if current conversation is loading
  // loadingConversationId is set at start and cleared when done (by response handler or WebSocket)
  const isCurrentConversationLoading = loadingConversationId === currentSessionId;

  // Clear loading state when loading completes (only if no WebSocket to handle it)
  // When wsConnected, the WebSocket handler clears loading when message is received
  useEffect(() => {
    if (!isLoading && !isUploading && loadingConversationId && !isDeepResearch && !wsConnected) {
      setLoadingConversationId(null);
      setLoadingMessageId(null);
    }
  }, [isLoading, isUploading, loadingConversationId, isDeepResearch, wsConnected]);

  // Clear loading message ID when switching conversations
  useEffect(() => {
    setLoadingMessageId(null);
    setIsDeepResearch(false);
  }, [currentSessionId]);

  // Auto-expand research panel when deep research starts
  useEffect(() => {
    if (isDeepResearch) {
      setIsResearchPanelExpanded(true);
    }
  }, [isDeepResearch]);

  // Detect deep research completion
  useEffect(() => {
    if (!isDeepResearch || !isCurrentConversationLoading) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      console.log("[ChatPage] Deep research completed - assistant message detected");
      setIsDeepResearch(false);
      setLoadingConversationId(null);
      setLoadingMessageId(null);
      clearLoading();
      scrollToBottom();
    }
  }, [messages, isDeepResearch, isCurrentConversationLoading]);

  // Watch for deep research completion via state
  useEffect(() => {
    if (!isCurrentConversationLoading || !currentState?.values) return;

    const { finalResponse, steps, isDeepResearch: isDeepRes, messageId } = currentState.values;

    if (!isDeepRes) return;
    if (messageId !== loadingMessageId) return;

    if (finalResponse && steps) {
      const allStepsComplete = Object.values(steps).every((step: any) => step.end);

      if (allStepsComplete) {
        console.log("[ChatPage] Deep research complete, finalizing message");

        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === "assistant" && lastMessage?.content === finalResponse) {
          return;
        }

        const capturedState = {
          steps: currentState.values.steps,
          source: currentState.values.source,
          thought: currentState.values.thought,
        };

        addMessage({
          id: Date.now(),
          role: "assistant" as const,
          content: finalResponse,
          timestamp: new Date(),
          thinkingState: capturedState,
        });

        scrollToBottom();
        setLoadingConversationId(null);
        setLoadingMessageId(null);
      }
    }
  }, [currentState, isCurrentConversationLoading, messages, loadingMessageId]);

  // Ref to track loading message ID for polling (avoids stale closure)
  const loadingMessageIdRef = useRef(loadingMessageId);
  useEffect(() => {
    loadingMessageIdRef.current = loadingMessageId;
  }, [loadingMessageId]);

  // Track previous suggestedNextSteps count to detect when research completes
  const prevSuggestedStepsCountRef = useRef(0);

  // Detect research completion via conversation state and trigger message refresh
  // This is the most reliable way to know when deep research is done
  useEffect(() => {
    if (!isCurrentConversationLoading) return;

    const currentStepsCount = researchState?.suggestedNextSteps?.length || 0;
    const prevCount = prevSuggestedStepsCountRef.current;

    // If suggestedNextSteps just appeared (went from 0 to >0), research completed
    if (currentStepsCount > 0 && prevCount === 0) {
      console.log("[ChatPage] Research completed - suggestedNextSteps appeared, refreshing messages");

      // Refetch messages from DB to get the response
      refetchMessages().then(() => {
        // Clear loading states after refresh
        setIsDeepResearch(false);
        setLoadingConversationId(null);
        setLoadingMessageId(null);
      });
    }

    prevSuggestedStepsCountRef.current = currentStepsCount;
  }, [researchState?.suggestedNextSteps?.length, isCurrentConversationLoading, refetchMessages]);

  // Poll for message content during loading (backup mechanism)
  // This runs whenever we're waiting for a response in this conversation
  useEffect(() => {
    // Only poll when we have a loading conversation that matches current session
    if (!loadingConversationId || loadingConversationId !== currentSessionId) return;

    let mounted = true;

    const pollForMessage = async () => {
      if (!mounted) return;

      const messageId = loadingMessageIdRef.current;
      if (!messageId) return;

      try {
        const dbMessages = await getMessagesByConversation(currentSessionId);
        const targetMsg = dbMessages.find((m: any) => m.id === messageId);

        if (targetMsg?.content && mounted) {
          // Atomic check-and-mark to prevent duplicates
          if (tryMarkAsProcessed(messageId, targetMsg.content)) {
            console.log("[ChatPage] Poll: Found message content, adding to UI:", messageId);
            addMessage({
              id: Date.now(),
              dbMessageId: messageId,
              role: "assistant" as const,
              content: targetMsg.content,
              timestamp: new Date(),
            });
          }

          // Clear loading states regardless
          setIsDeepResearch(false);
          setLoadingConversationId(null);
          setLoadingMessageId(null);
        }
      } catch (err) {
        console.error("[ChatPage] Poll error:", err);
      }
    };

    // Poll immediately and then every 2 seconds (same interval as research state)
    pollForMessage();
    const pollInterval = setInterval(pollForMessage, 2000);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
    };
  }, [loadingConversationId, currentSessionId, addMessage, tryMarkAsProcessed]);

  // Fetch and attach states to messages
  useEffect(() => {
    if (!currentSessionId || !userId) return;
    if (messages.length === 0) return;

    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const messagesNeedingStates = assistantMessages.filter((m) => !m.thinkingState);

    if (messagesNeedingStates.length === 0) return;

    async function fetchAndAttachStates() {
      try {
        const { getStatesByConversation } = await import("../lib/supabase");
        const states = await getStatesByConversation(currentSessionId);

        if (!states || states.length === 0) return false;

        const stateByMessageId = new Map<string, any>();
        for (const state of states) {
          if (state.values?.messageId) {
            stateByMessageId.set(state.values.messageId, state);
          }
        }

        let stateIndex = 0;
        let attachedCount = 0;
        updateSessionMessages(currentSessionId, (prev) =>
          prev.map((msg) => {
            if (msg.role !== "assistant" || msg.thinkingState) return msg;

            let state = msg.dbMessageId ? stateByMessageId.get(msg.dbMessageId) : null;

            if (!state && stateIndex < states.length) {
              state = states[stateIndex];
              stateIndex++;
            }

            if (state?.values) {
              attachedCount++;
              return {
                ...msg,
                thinkingState: {
                  steps: state.values.steps,
                  source: state.values.source,
                  thought: state.values.thought,
                },
              };
            }

            return msg;
          }),
        );

        return attachedCount > 0;
      } catch (err) {
        console.error("[ChatPage] Error fetching states:", err);
        return false;
      }
    }

    const timeoutId = setTimeout(async () => {
      const success = await fetchAndAttachStates();
      if (!success && messagesNeedingStates.length > 0) {
        setTimeout(fetchAndAttachStates, 2000);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [currentSessionId, userId, messages.length]);

  /**
   * Handle sending a message
   */
  const handleSend = async (mode: string = "normal") => {
    const trimmedInput = inputValue.trim();
    const hasFiles = selectedFiles.length > 0;

    if ((!trimmedInput && !hasFiles) || isLoading || isUploading) return;

    clearError();

    const fileText = hasFiles
      ? selectedFiles.length === 1
        ? `[Attached: ${selectedFiles[0].name}]`
        : `[Attached ${selectedFiles.length} files]`
      : "";

    const filesToUpload = [...selectedFiles];
    const messageContent = trimmedInput || fileText;
    const fileMetadata = hasFiles
      ? selectedFiles.map((f) => ({ name: f.name, size: f.size }))
      : undefined;

    setInputValue("");
    clearFile();

    const userMessage = {
      id: Date.now(),
      role: "user" as const,
      content: messageContent,
      timestamp: new Date(),
      files: fileMetadata,
    };

    addMessage(userMessage);

    const isFirstMessage = messages.length === 0;
    if (isFirstMessage) {
      const title = trimmedInput || filesToUpload[0]?.name || "New conversation";
      updateSessionTitle(currentSessionId, title);
      // Update URL to include session ID when first message is sent
      if (!urlSessionId) {
        route(`/chat/${currentSessionId}`, true);
      }
      // Persist the mode for this conversation
      setConversationModes(prev => ({
        ...prev,
        [currentSessionId]: mode as "normal" | "deep"
      }));
    }

    scrollToBottom();
    setLoadingConversationId(currentSessionId);

    try {
      if (hasFiles && filesToUpload.length > 0) {
        const uploadResults = await uploadToS3(filesToUpload, currentSessionId, actualUserId || undefined);

        if (uploadResults.length === 0) {
          throw new Error("Failed to upload files. Please try again.");
        }

        const failedUploads = uploadResults.filter(f => f.status === 'error');
        if (failedUploads.length > 0) {
          const failedNames = failedUploads.map(f => f.filename).join(', ');
          throw new Error(`Failed to upload: ${failedNames}`);
        }

        clearUploadedFiles();
        console.log(`[ChatPage] Files uploaded, proceeding to send message (${new Date().toISOString()})`);
      }

      console.log(`[ChatPage] Calling sendMessage... (${new Date().toISOString()})`);
      if (mode === "deep") {
        const response = await sendDeepResearchMessage({
          message: trimmedInput,
          conversationId: currentSessionId,
          userId: userId,
        });

        if (response.status === "rejected") {
          addMessage({
            id: Date.now(),
            role: "assistant" as const,
            content: response.error || "Deep research request was rejected. Please check the format.",
            timestamp: new Date(),
          });
          scrollToBottom();
          setLoadingConversationId(null);
          setLoadingMessageId(null);
        } else if (response.status === "processing") {
          console.log("[ChatPage] Deep research started, messageId:", response.messageId);
          setLoadingMessageId(response.messageId);
          setIsDeepResearch(true);
        }
      } else {
        const response = await sendMessage({
          message: trimmedInput,
          conversationId: currentSessionId,
          userId: userId,
        });

        if (response.text) {
          // Atomic check-and-mark to prevent duplicates
          if (tryMarkAsProcessed(response.messageId, response.text)) {
            console.log(`[ChatPage] HTTP: Adding message from response: ${response.messageId}`);
            addMessage({
              id: Date.now() + 1,
              dbMessageId: response.messageId,
              role: "assistant" as const,
              content: response.text,
              timestamp: new Date(),
            });
            scrollToBottom();
          }

          // Clear loading state
          setLoadingConversationId(null);
          setLoadingMessageId(null);
        }
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      removeMessage(userMessage.id);
      setInputValue(trimmedInput);
      setLoadingConversationId(null);
      setLoadingMessageId(null);

      if (err.message?.includes("upload") || err.message?.includes("Upload")) {
        toast.error(`File upload failed: ${err.message}`, 6000);
      }
    }
  };

  // Handle session navigation with routing
  const handleSessionSelect = (id: string) => {
    switchSession(id);
    route(`/chat/${id}`, true);
    setIsMobileSidebarOpen(false);
  };

  const handleNewSession = () => {
    createNewSession();
    route(`/chat`, true);
    setIsMobileSidebarOpen(false);
  };

  // Show loading screen while initial data loads
  if (isLoadingSessions && sessions.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary, #0a0a0a)',
        color: 'var(--text-secondary, #a1a1a1)',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <ConversationProvider
      userId={userId}
      conversationId={currentSessionId}
      conversationStateId={conversationState?.id}
    >
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
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          {error && <ErrorMessage message={error} onClose={clearError} />}

          <div className="chat-container" ref={containerRef}>
            {isLoadingSessions ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>
                Loading conversations...
              </div>
            ) : (
              <>
                {messages.length === 0 && !isCurrentConversationLoading && (
                  <WelcomeScreen onExampleClick={(text) => setInputValue(text)} />
                )}

                {messages.map((msg) => (
                  <Message key={msg.id} message={msg} />
                ))}

                {isCurrentConversationLoading && <TypingIndicator />}

                {showResearchPanel && (
                  <div className="research-section-container">
                    <ResearchStatePanel
                      state={researchState}
                      isExpanded={isResearchPanelExpanded}
                      onToggle={() => setIsResearchPanelExpanded(!isResearchPanelExpanded)}
                      isLoading={isDeepResearch && !hasActiveDeepResearch}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            disabled={isCurrentConversationLoading || isUploading}
            placeholder={isUploading ? "Uploading files..." : "Type your message..."}
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
            conversationMode={currentConversationMode}
            onModeChange={(newMode: "normal" | "deep") => {
              setConversationModes(prev => ({
                ...prev,
                [currentSessionId]: newMode
              }));
            }}
            isNewConversation={messages.length === 0}
          />
        </div>
      </div>

    </ConversationProvider>
  );
}
