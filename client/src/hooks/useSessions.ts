import { useEffect, useState } from "preact/hooks";
import {
  Message as DBMessage,
  getConversationsByUser,
  getMessagesByConversation,
  supabase,
} from "../lib/supabase";
import { generateConversationId } from "../utils/helpers";

export interface Message {
  id: number;
  dbMessageId?: string; // Database UUID for matching with states
  role: "user" | "assistant";
  content: string;
  timestamp?: Date; // When the message was sent/received
  file?: {
    name: string;
    size: number;
  };
  files?: Array<{
    name?: string;
    filename?: string;
    size?: number;
    mimeType?: string;
  }>;
  thinkingState?: {
    steps: Record<string, { start: number; end?: number }>;
    source?: string;
    thought?: string;
  };
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
}

export interface UseSessionsReturn {
  sessions: Session[];
  currentSession: Session;
  currentSessionId: string;
  userId: string;
  isLoading: boolean;
  addMessage: (message: Message) => void;
  removeMessage: (messageId: number) => void;
  updateSessionMessages: (
    sessionId: string,
    updater: (messages: Message[]) => Message[],
  ) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  createNewSession: () => Session;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  refetchMessages: () => Promise<void>;
}

// Convert DB messages to UI messages
// Each DB message contains both question and content (answer)
// We need to split them into separate user and assistant messages
function convertDBMessagesToUIMessages(dbMessages: DBMessage[]): Message[] {
  const uiMessages: Message[] = [];
  let idCounter = 0;

  for (const dbMsg of dbMessages) {
    const msgTimestamp = dbMsg.created_at ? new Date(dbMsg.created_at) : new Date();

    // Add user message (question) with files if present
    if (dbMsg.question) {
      uiMessages.push({
        id: Date.now() + idCounter++,
        role: "user",
        content: dbMsg.question,
        timestamp: msgTimestamp,
        files: dbMsg.files
          ? dbMsg.files.map((f: any) => ({
              name: f.name,
              filename: f.name,
              size: f.size,
              mimeType: f.type,
            }))
          : undefined,
      });
    }

    // Add assistant message (content/answer) if not empty
    if (dbMsg.content && dbMsg.content.trim() !== "") {
      uiMessages.push({
        id: Date.now() + idCounter++,
        role: "assistant",
        content: dbMsg.content,
        timestamp: dbMsg.updated_at ? new Date(dbMsg.updated_at) : msgTimestamp,
      });
    }
  }

  return uiMessages;
}

/**
 * Get or create a persistent dev user ID from localStorage
 * This ensures the same user ID is used across page refreshes
 * Uses the same key as App.tsx for consistency
 */
function getOrCreateDevUserId(): string {
  const STORAGE_KEY = "dev_user_id";
  const stored = localStorage.getItem(STORAGE_KEY);

  // Migration: If stored ID is old format (dev_user_*), clear it and generate new UUID
  if (stored && stored.startsWith("dev_user_")) {
    console.log(
      "[useSessions] Migrating old dev user ID to UUID format:",
      stored,
    );
    localStorage.removeItem(STORAGE_KEY);
    // Fall through to create new UUID
  } else if (stored) {
    return stored;
  }

  const newId = generateConversationId();
  localStorage.setItem(STORAGE_KEY, newId);
  console.log("[useSessions] Created new persistent dev user ID:", newId);
  return newId;
}

/**
 * Custom hook for managing chat sessions with Supabase integration
 * Handles session creation, deletion, switching, and message updates
 * Syncs with Supabase database and subscribes to real-time updates
 *
 * @param walletUserId - The actual user ID (deterministic UUID from wallet or dev user ID)
 * @param x402Enabled - Whether x402 payment mode is enabled (affects fallback behavior)
 * @param wsConnected - Whether WebSocket is connected (if true, Supabase Realtime is disabled as WS is primary)
 */
export function useSessions(walletUserId?: string, x402Enabled?: boolean, wsConnected?: boolean): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // When x402 is enabled, ONLY use the provided wallet user ID (no fallback)
  // When x402 is disabled, fall back to dev user ID for non-wallet users
  // This prevents mixing up conversations between different auth methods
  const userId = x402Enabled
    ? walletUserId || ""  // x402: require wallet ID, empty string means not logged in
    : (walletUserId || getOrCreateDevUserId());  // non-x402: fall back to dev user

  // Provide a default session to prevent undefined errors during initial load
  const currentSession = sessions.find((s) => s.id === currentSessionId) ||
    sessions[0] || {
      id: "",
      title: "Loading...",
      messages: [],
    };

  /**
   * Load conversations and messages from Supabase on mount
   * Only loads when we have a valid userId
   */
  useEffect(() => {
    // Skip loading if no userId (x402 mode but wallet not connected)
    if (!userId) {
      console.log("[useSessions] No userId, skipping conversation load (waiting for wallet)");
      setIsLoading(false);
      // Create a temporary empty session for UI
      const tempSession = {
        id: generateConversationId(),
        title: "New conversation",
        messages: [],
      };
      setSessions([tempSession]);
      setCurrentSessionId(tempSession.id);
      return;
    }

    console.log("[useSessions] Loading conversations for userId:", userId);

    let mounted = true;

    async function loadConversations() {
      // Preserve the current session's messages (in case wallet connected after sending message)
      // Define this OUTSIDE try block so it's accessible in catch block
      const currentSessionBeforeLoad = sessions.find(
        (s) => s.id === currentSessionId,
      );
      const hasMessagesInCurrentSession =
        currentSessionBeforeLoad &&
        currentSessionBeforeLoad.messages.length > 0;

      try {
        setIsLoading(true);

        // Fetch all conversations for this user
        const conversations = await getConversationsByUser(userId);
        console.log(
          "[useSessions] Fetched conversations for userId:",
          userId,
          "count:",
          conversations?.length || 0,
        );

        if (!mounted) return;

        if (conversations && conversations.length > 0) {
          // Load messages for each conversation
          const sessionsWithMessages = await Promise.all(
            conversations.map(async (conv) => {
              try {
                const messages = await getMessagesByConversation(conv.id!);

                // Convert DB messages to UI format
                const uiMessages = convertDBMessagesToUIMessages(messages);

                // Generate title from first message or use default
                const title =
                  messages.length > 0 && messages[0].question
                    ? messages[0].question.slice(0, 30) +
                      (messages[0].question.length > 30 ? "..." : "")
                    : "New conversation";

                return {
                  id: conv.id!,
                  title,
                  messages: uiMessages,
                };
              } catch (err) {
                console.error(
                  `Error loading messages for conversation ${conv.id}:`,
                  err,
                );
                return {
                  id: conv.id!,
                  title: "New conversation",
                  messages: [],
                };
              }
            }),
          );

          if (mounted) {
            // If we had messages in a temporary session, preserve them by keeping that session
            if (hasMessagesInCurrentSession) {
              console.log(
                "[useSessions] Preserving temporary session with messages",
              );
              console.log(
                "[useSessions] Loaded sessions count:",
                sessionsWithMessages.length,
              );
              console.log(
                "[useSessions] Total sessions (with temp):",
                sessionsWithMessages.length + 1,
              );
              setSessions([currentSessionBeforeLoad!, ...sessionsWithMessages]);
              // Keep the current session ID (don't switch to loaded session)
            } else {
              console.log(
                "[useSessions] Loading sessions without temp:",
                sessionsWithMessages.length,
              );
              console.log(
                "[useSessions] Sessions:",
                sessionsWithMessages.map((s) => ({
                  id: s.id,
                  title: s.title,
                  messageCount: s.messages.length,
                })),
              );
              setSessions(sessionsWithMessages);
              setCurrentSessionId(sessionsWithMessages[0].id);
            }
          }
        } else {
          // No conversations found
          if (mounted) {
            // If we had messages in a temporary session, preserve it
            if (hasMessagesInCurrentSession) {
              console.log(
                "[useSessions] No conversations found, preserving temporary session with messages",
              );
              setSessions([currentSessionBeforeLoad!]);
              // Keep the current session ID
            } else {
              // Create a new session
              const newSession = {
                id: generateConversationId(),
                title: "New conversation",
                messages: [],
              };
              setSessions([newSession]);
              setCurrentSessionId(newSession.id);
            }
          }
        }
      } catch (err) {
        console.error("Error loading conversations:", err);
        // Fallback to local session
        if (mounted) {
          // If we had messages in a temporary session, preserve it
          if (hasMessagesInCurrentSession) {
            console.log(
              "[useSessions] Error loading, preserving temporary session with messages",
            );
            setSessions([currentSessionBeforeLoad!]);
            // Keep the current session ID
          } else {
            const newSession = {
              id: generateConversationId(),
              title: "New conversation",
              messages: [],
            };
            setSessions([newSession]);
            setCurrentSessionId(newSession.id);
          }
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadConversations();

    return () => {
      mounted = false;
    };
  }, [userId]);

  /**
   * Polling for message updates
   * Always active to ensure messages appear in realtime (same as research state)
   * Polls every 2 seconds for consistency with research state polling
   */
  useEffect(() => {
    if (!currentSessionId || !userId) return;

    console.log("[useSessions] Message polling enabled");

    let mounted = true;
    let pollCount = 0;
    const maxPolls = 900; // 30 minutes max polling (900 * 2s)

    const pollForUpdates = async () => {
      if (!mounted || pollCount >= maxPolls) return;
      pollCount++;

      try {
        const messages = await getMessagesByConversation(currentSessionId);
        if (!mounted) return;

        const uiMessages = convertDBMessagesToUIMessages(messages);

        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== currentSessionId) return session;

            // Count assistant messages
            const currentAssistantMsgs = session.messages.filter(m => m.role === "assistant");
            const newAssistantMsgs = uiMessages.filter(m => m.role === "assistant");

            // Build set of existing content for duplicate detection
            const existingContents = new Set(currentAssistantMsgs.map(m => m.content.trim()));

            // Only add messages that don't already exist
            const trulyNewMsgs = newAssistantMsgs.filter(m => !existingContents.has(m.content.trim()));

            if (trulyNewMsgs.length > 0) {
              console.log("[Polling] Found truly new messages:", trulyNewMsgs.length);
              return { ...session, messages: [...session.messages, ...trulyNewMsgs] };
            }

            return session;
          })
        );
      } catch (err) {
        // Silently ignore polling errors
      }
    };

    // Poll every 2 seconds (same as research state)
    const pollInterval = setInterval(pollForUpdates, 2000);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
    };
  }, [currentSessionId, userId]);

  /**
   * Subscribe to real-time message updates for current conversation
   *
   * This is the FALLBACK when WebSocket is not connected.
   * WebSocket (/api/ws) is the PRIMARY real-time channel.
   * When wsConnected=true, this effect does nothing to avoid duplicates.
   */
  useEffect(() => {
    if (!currentSessionId) return;

    // If WebSocket is connected, don't use Supabase Realtime (WS is primary)
    if (wsConnected) {
      console.log("[useSessions] WebSocket connected - Supabase Realtime disabled");
      return;
    }

    console.log("[useSessions] WebSocket not connected - using Supabase Realtime as fallback");

    const channel = supabase
      .channel(`messages:${currentSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${currentSessionId}`,
        },
        (payload) => {
          console.log("[Realtime] Message INSERT:", payload);
          const newMessage = payload.new as DBMessage;

          // Convert DB message to UI messages (question + content)
          const uiMessages = convertDBMessagesToUIMessages([newMessage]);

          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== currentSessionId) return session;

              // Advanced duplicate detection: check by content similarity
              const existingMessages = session.messages;
              const newMessagesToAdd: Message[] = [];

              for (const uiMsg of uiMessages) {
                const trimmedContent = uiMsg.content.trim();
                if (!trimmedContent) continue; // Skip empty messages

                // IMPORTANT: NEVER add user messages from real-time INSERT
                // User messages are ALWAYS added locally first via addMessage()
                // Adding from INSERT causes duplicates due to race conditions
                if (uiMsg.role === "user") {
                  console.log(
                    "[Realtime] Skipping user message from INSERT (UI handles these):",
                    trimmedContent.slice(0, 50),
                  );
                  continue;
                }

                // Check if an assistant message with this content already exists
                const isDuplicate = existingMessages.some((existing) => {
                  if (existing.role !== "assistant") return false;
                  const existingText = existing.content.trim();

                  // Exact match - always a duplicate
                  if (existingText === trimmedContent) return true;

                  // Check for partial matches (typing animation in progress)
                  // If trimmedContent is the full response and existingText is partial (animating)
                  if (
                    existingText.length > 0 &&
                    trimmedContent.startsWith(existingText)
                  )
                    return true;
                  // If existingText is the full response and trimmedContent is partial
                  if (
                    trimmedContent.length > 0 &&
                    existingText.startsWith(trimmedContent)
                  )
                    return true;
                  // If existing is empty (animation just started)
                  if (existingText === "") return true;

                  return false;
                });

                if (!isDuplicate) {
                  console.log(
                    "[Realtime] Adding new assistant message from INSERT:",
                    trimmedContent.slice(0, 50),
                  );
                  newMessagesToAdd.push(uiMsg);
                } else {
                  console.log(
                    "[Realtime] Skipping duplicate assistant message from INSERT:",
                    trimmedContent.slice(0, 50),
                  );
                }
              }

              if (newMessagesToAdd.length === 0) return session;

              return {
                ...session,
                messages: [...session.messages, ...newMessagesToAdd],
              };
            }),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${currentSessionId}`,
        },
        (payload) => {
          console.log("[Realtime] Message UPDATE:", payload);
          const updatedMessage = payload.new as DBMessage;

          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== currentSessionId) return session;

              // When a message is updated, the backend is updating the content (assistant response)
              if (!updatedMessage.content || !updatedMessage.content.trim()) {
                return session; // No content to update
              }

              const messages = [...session.messages];
              const updatedContent = updatedMessage.content.trim();

              // FIRST: Check if this exact content already exists ANYWHERE
              // This handles the case where App.tsx already added the message
              const contentAlreadyExists = messages.some(
                (m) =>
                  m.role === "assistant" &&
                  m.content.trim() === updatedContent,
              );

              if (contentAlreadyExists) {
                console.log(
                  "[Realtime] UPDATE: Content already exists globally, skipping:",
                  updatedContent.slice(0, 50),
                );
                return session;
              }

              // Find the user message with this question
              let userMsgIndex = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (
                  messages[i].role === "user" &&
                  messages[i].content === updatedMessage.question
                ) {
                  userMsgIndex = i;
                  break;
                }
              }

              if (userMsgIndex === -1) {
                console.log(
                  "[Realtime] UPDATE: Could not find matching user message",
                );
                return session; // Can't find the user message, skip
              }

              const nextIndex = userMsgIndex + 1;

              // Check if assistant message already exists after user message
              if (
                nextIndex < messages.length &&
                messages[nextIndex].role === "assistant"
              ) {
                const existingContent = messages[nextIndex].content.trim();

                console.log(
                  "[Realtime] UPDATE: Found existing assistant message",
                );
                console.log(
                  "[Realtime] UPDATE: Existing content length:",
                  existingContent.length,
                );
                console.log(
                  "[Realtime] UPDATE: Updated content length:",
                  updatedContent.length,
                );
                console.log(
                  "[Realtime] UPDATE: Existing preview:",
                  existingContent.slice(0, 100),
                );
                console.log(
                  "[Realtime] UPDATE: Updated preview:",
                  updatedContent.slice(0, 100),
                );

                // IMPORTANT: During typing animation, existingContent may be a partial substring
                // of updatedContent. We should NOT update if:
                // 1. Content already matches exactly (animation finished)
                // 2. Updated content starts with existing content (animation in progress)
                // 3. Existing content is empty (animation just started)
                const isAnimating =
                  existingContent === "" ||
                  updatedContent.startsWith(existingContent);
                const isIdentical = existingContent === updatedContent;

                console.log(
                  "[Realtime] UPDATE: isAnimating?",
                  isAnimating,
                  "isIdentical?",
                  isIdentical,
                );

                if (isIdentical) {
                  console.log(
                    "[Realtime] Skipping UPDATE - content already matches",
                  );
                } else if (isAnimating) {
                  console.log(
                    "[Realtime] Skipping UPDATE - typing animation in progress",
                  );
                } else {
                  console.log(
                    "[Realtime] Updating assistant message from UPDATE (content changed)",
                  );
                  messages[nextIndex] = {
                    ...messages[nextIndex],
                    content: updatedMessage.content,
                  };
                }
              } else {
                // No assistant message exists yet at nextIndex
                // Check if this content already exists ANYWHERE in messages (race condition protection)
                const contentAlreadyExists = messages.some(
                  (m) =>
                    m.role === "assistant" &&
                    m.content.trim() === updatedContent,
                );

                if (contentAlreadyExists) {
                  console.log(
                    "[Realtime] UPDATE: Content already exists, skipping:",
                    updatedContent.slice(0, 50),
                  );
                } else {
                  // Add the assistant message - this is the ONLY place messages get added
                  // Both normal chat and deep research flow through here
                  console.log(
                    "[Realtime] UPDATE: Adding assistant message:",
                    updatedContent.slice(0, 50),
                  );

                  messages.splice(nextIndex, 0, {
                    id: Date.now(),
                    dbMessageId: updatedMessage.id, // Store DB ID for state matching
                    role: "assistant" as const,
                    content: updatedContent,
                  });
                }
              }

              return {
                ...session,
                messages,
              };
            }),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentSessionId, wsConnected]);

  /**
   * Update messages for a specific session
   */
  const updateSessionMessages = (
    sessionId: string,
    updater: (messages: Message[]) => Message[],
  ) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? { ...session, messages: updater(session.messages) }
          : session,
      ),
    );
  };

  /**
   * Add a message to the current session
   */
  const addMessage = (message: Message) => {
    console.log(
      "[useSessions.addMessage] Adding message to session:",
      currentSessionId,
      "message:",
      message,
    );
    console.log(
      "[useSessions.addMessage] Current sessions:",
      sessions.map((s) => ({ id: s.id, messageCount: s.messages.length })),
    );
    updateSessionMessages(currentSessionId, (prev) => {
      console.log(
        "[useSessions.addMessage] Previous messages:",
        prev.length,
        "new count:",
        prev.length + 1,
      );
      return [...prev, message];
    });
  };

  /**
   * Remove a message from the current session
   */
  const removeMessage = (messageId: number) => {
    updateSessionMessages(currentSessionId, (prev) =>
      prev.filter((msg) => msg.id !== messageId),
    );
  };

  /**
   * Update session title (typically after first message)
   */
  const updateSessionTitle = (sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: title.slice(0, 30) + (title.length > 30 ? "..." : ""),
            }
          : session,
      ),
    );
  };

  /**
   * Create a new session and switch to it
   */
  const createNewSession = (): Session => {
    const newSession: Session = {
      id: generateConversationId(),
      title: "New conversation",
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    return newSession;
  };

  /**
   * Delete a session
   * If it's the last session, just clear its messages
   */
  const deleteSession = (sessionId: string) => {
    if (sessions.length === 1) {
      updateSessionMessages(sessionId, () => []);
      updateSessionTitle(sessionId, "New conversation");
    } else {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        const nextSession = sessions.find((s) => s.id !== sessionId);
        if (nextSession) {
          setCurrentSessionId(nextSession.id);
        }
      }
    }
  };

  /**
   * Switch to a different session
   */
  const switchSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
  };

  /**
   * Refetch messages for current session from database
   * Used as a "soft refresh" when polling doesn't catch updates
   */
  const refetchMessages = async () => {
    if (!currentSessionId) return;

    try {
      const messages = await getMessagesByConversation(currentSessionId);
      const uiMessages = convertDBMessagesToUIMessages(messages);

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== currentSessionId) return session;

          // Only update if there are new messages we don't have
          const currentAssistantCount = session.messages.filter(m => m.role === "assistant").length;
          const newAssistantCount = uiMessages.filter(m => m.role === "assistant").length;

          if (newAssistantCount > currentAssistantCount) {
            console.log("[useSessions] refetchMessages: Found new messages, updating session");
            return { ...session, messages: uiMessages };
          }

          // Also check if any assistant message has content that we're missing
          const hasNewContent = uiMessages.some(newMsg => {
            if (newMsg.role !== "assistant" || !newMsg.content) return false;
            const existingMsg = session.messages.find(
              m => m.role === "assistant" && m.content === newMsg.content
            );
            return !existingMsg;
          });

          if (hasNewContent) {
            console.log("[useSessions] refetchMessages: Found new content, updating session");
            return { ...session, messages: uiMessages };
          }

          return session;
        })
      );
    } catch (err) {
      console.error("[useSessions] refetchMessages error:", err);
    }
  };

  return {
    sessions,
    currentSession,
    currentSessionId,
    userId,
    isLoading,
    addMessage,
    removeMessage,
    updateSessionMessages,
    updateSessionTitle,
    createNewSession,
    deleteSession,
    switchSession,
    refetchMessages,
  };
}
