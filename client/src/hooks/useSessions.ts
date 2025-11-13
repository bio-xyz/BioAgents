import { useState, useEffect, useMemo } from 'preact/hooks';
import { generateConversationId } from '../utils/helpers';
import {
  supabase,
  getConversationsByUser,
  getMessagesByConversation,
  Message as DBMessage
} from '../lib/supabase';

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
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
  updateSessionMessages: (sessionId: string, updater: (messages: Message[]) => Message[]) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  createNewSession: () => Session;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
}

// Convert DB messages to UI messages
// Each DB message contains both question and content (answer)
// We need to split them into separate user and assistant messages
function convertDBMessagesToUIMessages(dbMessages: DBMessage[]): Message[] {
  const uiMessages: Message[] = [];
  let idCounter = 0;

  for (const dbMsg of dbMessages) {
    // Add user message (question) with files if present
    if (dbMsg.question) {
      uiMessages.push({
        id: Date.now() + idCounter++,
        role: 'user',
        content: dbMsg.question,
        files: dbMsg.files ? dbMsg.files.map((f: any) => ({
          name: f.name,
          filename: f.name,
          size: f.size,
          mimeType: f.type,
        })) : undefined,
      });
    }

    // Add assistant message (content/answer) if not empty
    if (dbMsg.content && dbMsg.content.trim() !== '') {
      uiMessages.push({
        id: Date.now() + idCounter++,
        role: 'assistant',
        content: dbMsg.content,
      });
    }
  }

  return uiMessages;
}

/**
 * Custom hook for managing chat sessions with Supabase integration
 * Handles session creation, deletion, switching, and message updates
 * Syncs with Supabase database and subscribes to real-time updates
 *
 * @param walletUserId - The actual user ID (wallet address or Privy ID) to load conversations for
 */
export function useSessions(walletUserId?: string): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Use provided wallet user ID, or generate a stable temporary one if not available
  // useMemo ensures the generated ID doesn't change on every render
  const userId = useMemo(() => {
    return walletUserId || generateConversationId();
  }, [walletUserId]);

  // Provide a default session to prevent undefined errors during initial load
  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0] || {
    id: '',
    title: 'Loading...',
    messages: []
  };

  /**
   * Load conversations and messages from Supabase on mount
   * Only load if we have a valid wallet user ID
   */
  useEffect(() => {
    // Don't load if we don't have a wallet user ID yet
    if (!walletUserId) {
      setIsLoading(false);
      // Create a temporary session for immediate use
      const tempSession = {
        id: generateConversationId(),
        title: 'New conversation',
        messages: [],
      };
      setSessions([tempSession]);
      setCurrentSessionId(tempSession.id);
      return;
    }

    let mounted = true;

    async function loadConversations() {
      // Preserve the current session's messages (in case wallet connected after sending message)
      // Define this OUTSIDE try block so it's accessible in catch block
      const currentSessionBeforeLoad = sessions.find(s => s.id === currentSessionId);
      const hasMessagesInCurrentSession = currentSessionBeforeLoad && currentSessionBeforeLoad.messages.length > 0;

      try {
        setIsLoading(true);

        // Fetch all conversations for this user
        const conversations = await getConversationsByUser(userId);
        console.log('[useSessions] Fetched conversations for userId:', userId, 'count:', conversations?.length || 0);

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
                const title = messages.length > 0 && messages[0].question
                  ? messages[0].question.slice(0, 30) + (messages[0].question.length > 30 ? '...' : '')
                  : 'New conversation';

                return {
                  id: conv.id!,
                  title,
                  messages: uiMessages,
                };
              } catch (err) {
                console.error(`Error loading messages for conversation ${conv.id}:`, err);
                return {
                  id: conv.id!,
                  title: 'New conversation',
                  messages: [],
                };
              }
            })
          );

          if (mounted) {
            // If we had messages in a temporary session, preserve them by keeping that session
            if (hasMessagesInCurrentSession) {
              console.log('[useSessions] Preserving temporary session with messages');
              console.log('[useSessions] Loaded sessions count:', sessionsWithMessages.length);
              console.log('[useSessions] Total sessions (with temp):', sessionsWithMessages.length + 1);
              setSessions([currentSessionBeforeLoad!, ...sessionsWithMessages]);
              // Keep the current session ID (don't switch to loaded session)
            } else {
              console.log('[useSessions] Loading sessions without temp:', sessionsWithMessages.length);
              console.log('[useSessions] Sessions:', sessionsWithMessages.map(s => ({ id: s.id, title: s.title, messageCount: s.messages.length })));
              setSessions(sessionsWithMessages);
              setCurrentSessionId(sessionsWithMessages[0].id);
            }
          }
        } else {
          // No conversations found
          if (mounted) {
            // If we had messages in a temporary session, preserve it
            if (hasMessagesInCurrentSession) {
              console.log('[useSessions] No conversations found, preserving temporary session with messages');
              setSessions([currentSessionBeforeLoad!]);
              // Keep the current session ID
            } else {
              // Create a new session
              const newSession = {
                id: generateConversationId(),
                title: 'New conversation',
                messages: [],
              };
              setSessions([newSession]);
              setCurrentSessionId(newSession.id);
            }
          }
        }
      } catch (err) {
        console.error('Error loading conversations:', err);
        // Fallback to local session
        if (mounted) {
          // If we had messages in a temporary session, preserve it
          if (hasMessagesInCurrentSession) {
            console.log('[useSessions] Error loading, preserving temporary session with messages');
            setSessions([currentSessionBeforeLoad!]);
            // Keep the current session ID
          } else {
            const newSession = {
              id: generateConversationId(),
              title: 'New conversation',
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
  }, [userId, walletUserId]);

  /**
   * Subscribe to real-time message updates for current conversation
   *
   * IMPORTANT: We need careful duplicate detection here because:
   * 1. UI manually adds messages when user sends (App.tsx)
   * 2. Backend creates/updates DB records → triggers INSERT/UPDATE events
   * 3. We must prevent adding the same messages again
   *
   * Strategy: Check if message content already exists before adding
   */
  useEffect(() => {
    if (!currentSessionId) return;

    const channel = supabase
      .channel(`messages:${currentSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${currentSessionId}`,
        },
        (payload) => {
          console.log('[Realtime] Message INSERT:', payload);
          const newMessage = payload.new as DBMessage;

          // Convert DB message to UI messages (question + content)
          const uiMessages = convertDBMessagesToUIMessages([newMessage]);

          setSessions(prev =>
            prev.map(session => {
              if (session.id !== currentSessionId) return session;

              // Advanced duplicate detection: check by content similarity
              const existingMessages = session.messages;
              const newMessagesToAdd: Message[] = [];

              for (const uiMsg of uiMessages) {
                const trimmedContent = uiMsg.content.trim();
                if (!trimmedContent) continue; // Skip empty messages

                // Check if a message with this content already exists
                // For assistant messages, also check for partial matches (animation in progress)
                const isDuplicate = existingMessages.some(existing => {
                  if (existing.role !== uiMsg.role) return false;
                  const existingText = existing.content.trim();

                  // Exact match - always a duplicate
                  if (existingText === trimmedContent) return true;

                  // For assistant messages, check for partial matches (typing animation)
                  if (uiMsg.role === 'assistant') {
                    // If trimmedContent is the full response and existingText is partial (animating)
                    if (existingText.length > 0 && trimmedContent.startsWith(existingText)) return true;
                    // If existingText is the full response and trimmedContent is partial (shouldn't happen but be safe)
                    if (trimmedContent.length > 0 && existingText.startsWith(trimmedContent)) return true;
                    // If existing is empty (animation just started)
                    if (existingText === '' && uiMsg.role === 'assistant') return true;
                  }

                  return false;
                });

                if (!isDuplicate) {
                  console.log('[Realtime] Adding new message from INSERT:', uiMsg.role, trimmedContent.slice(0, 50));
                  newMessagesToAdd.push(uiMsg);
                } else {
                  console.log('[Realtime] Skipping duplicate from INSERT:', uiMsg.role, trimmedContent.slice(0, 50));
                }
              }

              if (newMessagesToAdd.length === 0) return session;

              return {
                ...session,
                messages: [...session.messages, ...newMessagesToAdd],
              };
            })
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${currentSessionId}`,
        },
        (payload) => {
          console.log('[Realtime] Message UPDATE:', payload);
          const updatedMessage = payload.new as DBMessage;

          setSessions(prev =>
            prev.map(session => {
              if (session.id !== currentSessionId) return session;

              // When a message is updated, the backend is updating the content (assistant response)
              if (!updatedMessage.content || !updatedMessage.content.trim()) {
                return session; // No content to update
              }

              const messages = [...session.messages];
              const updatedContent = updatedMessage.content.trim();

              // Find the user message with this question
              let userMsgIndex = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user' && messages[i].content === updatedMessage.question) {
                  userMsgIndex = i;
                  break;
                }
              }

              if (userMsgIndex === -1) {
                console.log('[Realtime] UPDATE: Could not find matching user message');
                return session; // Can't find the user message, skip
              }

              const nextIndex = userMsgIndex + 1;

              // Check if assistant message already exists after user message
              if (nextIndex < messages.length && messages[nextIndex].role === 'assistant') {
                const existingContent = messages[nextIndex].content.trim();

                console.log('[Realtime] UPDATE: Found existing assistant message');
                console.log('[Realtime] UPDATE: Existing content length:', existingContent.length);
                console.log('[Realtime] UPDATE: Updated content length:', updatedContent.length);
                console.log('[Realtime] UPDATE: Existing preview:', existingContent.slice(0, 100));
                console.log('[Realtime] UPDATE: Updated preview:', updatedContent.slice(0, 100));

                // IMPORTANT: During typing animation, existingContent may be a partial substring
                // of updatedContent. We should NOT update if:
                // 1. Content already matches exactly (animation finished)
                // 2. Updated content starts with existing content (animation in progress)
                // 3. Existing content is empty (animation just started)
                const isAnimating = existingContent === '' || updatedContent.startsWith(existingContent);
                const isIdentical = existingContent === updatedContent;

                console.log('[Realtime] UPDATE: isAnimating?', isAnimating, 'isIdentical?', isIdentical);

                if (isIdentical) {
                  console.log('[Realtime] Skipping UPDATE - content already matches');
                } else if (isAnimating) {
                  console.log('[Realtime] Skipping UPDATE - typing animation in progress');
                } else {
                  console.log('[Realtime] Updating assistant message from UPDATE (content changed)');
                  messages[nextIndex] = {
                    ...messages[nextIndex],
                    content: updatedMessage.content,
                  };
                }
              } else {
                // No assistant message exists yet after this user message
                console.log('[Realtime] UPDATE: No assistant message found at position', nextIndex);
                console.log('[Realtime] UPDATE: Total messages:', messages.length);
                console.log('[Realtime] UPDATE: Messages:', messages.map(m => `${m.role}: ${m.content.slice(0, 30)}...`));

                // CRITICAL FIX: If there's no assistant message at the expected position,
                // it means the UPDATE event fired BEFORE the UI created the typing animation.
                // In this case, we should ALWAYS skip because the UI will handle it.
                // We should NEVER add a message from UPDATE when none exists - the UI owns message creation.
                console.log('[Realtime] ⚠️ Skipping UPDATE - UI has not created assistant message yet');
                console.log('[Realtime] This UPDATE event fired too early, typing animation will handle it');

                // Don't add anything - let the UI's typing animation handle it
                return session;
              }

              return {
                ...session,
                messages,
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentSessionId]);

  /**
   * Update messages for a specific session
   */
  const updateSessionMessages = (sessionId: string, updater: (messages: Message[]) => Message[]) => {
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? { ...session, messages: updater(session.messages) }
          : session
      )
    );
  };

  /**
   * Add a message to the current session
   */
  const addMessage = (message: Message) => {
    console.log('[useSessions.addMessage] Adding message to session:', currentSessionId, 'message:', message);
    console.log('[useSessions.addMessage] Current sessions:', sessions.map(s => ({ id: s.id, messageCount: s.messages.length })));
    updateSessionMessages(currentSessionId, prev => {
      console.log('[useSessions.addMessage] Previous messages:', prev.length, 'new count:', prev.length + 1);
      return [...prev, message];
    });
  };

  /**
   * Remove a message from the current session
   */
  const removeMessage = (messageId: number) => {
    updateSessionMessages(currentSessionId, prev =>
      prev.filter(msg => msg.id !== messageId)
    );
  };

  /**
   * Update session title (typically after first message)
   */
  const updateSessionTitle = (sessionId: string, title: string) => {
    setSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? { ...session, title: title.slice(0, 30) + (title.length > 30 ? '...' : '') }
          : session
      )
    );
  };

  /**
   * Create a new session and switch to it
   */
  const createNewSession = (): Session => {
    const newSession: Session = {
      id: generateConversationId(),
      title: 'New conversation',
      messages: []
    };
    setSessions(prev => [newSession, ...prev]);
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
      updateSessionTitle(sessionId, 'New conversation');
    } else {
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        const nextSession = sessions.find(s => s.id !== sessionId);
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
  };
}
