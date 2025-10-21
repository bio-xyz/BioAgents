import { useState } from 'preact/hooks';
import { generateConversationId } from '../utils/helpers';

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
  addMessage: (message: Message) => void;
  removeMessage: (messageId: number) => void;
  updateSessionMessages: (sessionId: string, updater: (messages: Message[]) => Message[]) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  createNewSession: () => Session;
  deleteSession: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
}

/**
 * Custom hook for managing chat sessions
 * Handles session creation, deletion, switching, and message updates
 */
export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([
    { id: generateConversationId(), title: 'New conversation', messages: [] }
  ]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessions[0].id);

  const currentSession = sessions.find(s => s.id === currentSessionId) || sessions[0];

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
    addMessage,
    removeMessage,
    updateSessionMessages,
    updateSessionTitle,
    createNewSession,
    deleteSession,
    switchSession,
  };
}
