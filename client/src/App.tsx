import { useState } from "preact/hooks";

import { ChatInput } from "./components/ChatInput";
import { ErrorMessage } from "./components/ErrorMessage";
import { Message } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { TypingIndicator } from "./components/TypingIndicator";
import { WelcomeScreen } from "./components/WelcomeScreen";

// Custom hooks
import {
  useAutoScroll,
  useChatAPI,
  useFileUpload,
  useSessions,
  useTypingAnimation,
} from "./hooks";

export function App() {
  // Session management
  const {
    sessions,
    currentSession,
    currentSessionId,
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
  const { selectedFile, selectFile, removeFile, clearFile } = useFileUpload();

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
    if ((!trimmedInput && !selectedFile) || isLoading) return;

    clearError();

    // Create user message
    const userMessage = {
      id: Date.now(),
      role: "user" as const,
      content:
        trimmedInput ||
        (selectedFile ? `[Attached: ${selectedFile.name}]` : ""),
      file: selectedFile
        ? { name: selectedFile.name, size: selectedFile.size }
        : undefined,
    };

    addMessage(userMessage);

    // Update session title if it's the first message
    if (messages.length === 0) {
      const title = trimmedInput || selectedFile?.name || "New conversation";
      updateSessionTitle(currentSessionId, title);
    }

    // Store file reference before clearing state
    const fileToSend = selectedFile;

    // Clear input and file
    setInputValue("");
    clearFile();
    scrollToBottom();

    try {
      // Send message to API
      const responseText = await sendMessage({
        message: trimmedInput,
        conversationId: currentSessionId,
        userId: currentSessionId,
        file: fileToSend,
      });

      // Create temp message for typing animation
      const tempId = Date.now();
      addMessage({
        id: tempId,
        role: "assistant" as const,
        content: "",
      });

      // Animate the response
      await animateText(
        responseText,
        (currentText) => {
          updateSessionMessages(currentSessionId, (prev) =>
            prev.map((msg) =>
              msg.id === tempId ? { ...msg, content: currentText } : msg,
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
          {messages.length === 0 && (
            <WelcomeScreen onExampleClick={(text) => setInputValue(text)} />
          )}

          {messages.map((msg) => (
            <Message key={msg.id} message={msg} />
          ))}

          {isLoading && !isTyping && <TypingIndicator />}
        </div>

        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isLoading}
          placeholder="Type your message..."
          selectedFile={selectedFile}
          onFileSelect={selectFile}
          onFileRemove={removeFile}
        />
      </div>
    </div>
  );
}
