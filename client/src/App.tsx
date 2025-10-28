import { useState } from "preact/hooks";

import { ChatInput } from "./components/ChatInput";
import { ErrorMessage } from "./components/ErrorMessage";
import { Message } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { TypingIndicator } from "./components/TypingIndicator";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoginScreen } from "./components/LoginScreen";

// Custom hooks
import {
  useAutoScroll,
  useChatAPI,
  useFileUpload,
  useSessions,
  useTypingAnimation,
  useAuth,
} from "./hooks";

export function App() {
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

  // Chat API
  const { isLoading, error, sendMessage, clearError } = useChatAPI();

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
    } catch (err) {
      console.error("Chat error:", err);
      // Remove user message on error
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

        {error && <ErrorMessage message={error} onClose={clearError} />}

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
  );
}
