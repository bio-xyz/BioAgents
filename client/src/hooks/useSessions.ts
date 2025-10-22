import { useState, useEffect } from 'preact/hooks';
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

// Generate or retrieve mock user ID from localStorage
function getMockUserId(): string {
  const stored = localStorage.getItem('mock_user_id');
  if (stored) return stored;

  const newId = generateConversationId();
  localStorage.setItem('mock_user_id', newId);
  return newId;
}

// Convert DB messages to UI messages
// Each DB message contains both question and content (answer)
// We need to split them into separate user and assistant messages
function convertDBMessagesToUIMessages(dbMessages: DBMessage[]): Message[] {
  const uiMessages: Message[] = [];
  let idCounter = 0;

  for (const dbMsg of dbMessages) {
    // Add user message (question)
    if (dbMsg.question) {
      uiMessages.push({
        id: Date.now() + idCounter++,
        role: 'user',
        content: dbMsg.question,
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
 */
export function useSessions(): UseSessionsReturn {
  const [userId] = useState<string>(getMockUserId());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Provide a default session to prevent undefined errors during initial load
  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0] || {
    id: '',
    title: 'Loading...',
    messages: []
  };

  /**
   * Load conversations and messages from Supabase on mount
   */
  useEffect(() => {
    let mounted = true;

    async function loadConversations() {
      try {
        setIsLoading(true);

        // Fetch all conversations for this user
        const conversations = await getConversationsByUser(userId);

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
            setSessions(sessionsWithMessages);
            setCurrentSessionId(sessionsWithMessages[0].id);
          }
        } else {
          // No conversations found, create a new one
          if (mounted) {
            const newSession = {
              id: generateConversationId(),
              title: 'New conversation',
              messages: [],
            };
            setSessions([newSession]);
            setCurrentSessionId(newSession.id);
          }
        }
      } catch (err) {
        console.error('Error loading conversations:', err);
        // Fallback to local session
        if (mounted) {
          const newSession = {
            id: generateConversationId(),
            title: 'New conversation',
            messages: [],
          };
          setSessions([newSession]);
          setCurrentSessionId(newSession.id);
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
   * Subscribe to real-time message updates for current conversation
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
          console.log('New message inserted:', payload);
          const newMessage = payload.new as DBMessage;

          // Convert to UI message format (handles both question and content)
          const uiMessages = convertDBMessagesToUIMessages([newMessage]);

          // Add to current session if not already present
          setSessions(prev =>
            prev.map(session => {
              if (session.id !== currentSessionId) return session;

              // Filter out messages that already exist
              const existingIds = new Set(session.messages.map(m => m.id));
              const newMessages = uiMessages.filter(m => !existingIds.has(m.id));

              if (newMessages.length === 0) return session;

              return {
                ...session,
                messages: [...session.messages, ...newMessages],
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
          console.log('Message updated:', payload);
          const updatedMessage = payload.new as DBMessage;

          // When a message is updated, the backend is likely updating the content (assistant response)
          // We need to update or add the assistant message in the UI
          setSessions(prev =>
            prev.map(session => {
              if (session.id !== currentSessionId) return session;

              const messages = [...session.messages];

              // Find if we already have an assistant message for this DB message
              // We identify it by checking if the previous message (user message) matches the question
              if (updatedMessage.content && updatedMessage.content.trim() !== '') {
                // Find the last occurrence of the user message with this question
                let foundIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === 'user' && messages[i].content === updatedMessage.question) {
                    foundIndex = i;
                    break;
                  }
                }

                if (foundIndex !== -1) {
                  // Check if there's already an assistant message after this user message
                  const nextIndex = foundIndex + 1;
                  if (nextIndex < messages.length && messages[nextIndex].role === 'assistant') {
                    // Update existing assistant message
                    messages[nextIndex] = {
                      ...messages[nextIndex],
                      content: updatedMessage.content,
                    };
                  } else {
                    // Add new assistant message after the user message
                    messages.splice(nextIndex, 0, {
                      id: Date.now(),
                      role: 'assistant',
                      content: updatedMessage.content,
                    });
                  }
                }
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
    updateSessionMessages(currentSessionId, prev => [...prev, message]);
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
