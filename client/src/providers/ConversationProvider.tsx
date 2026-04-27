import { createContext } from "preact";
import { useContext } from "preact/hooks";

interface ConversationContextValue {
  userId: string | null;
  conversationId: string | null;
  conversationStateId: string | null;
}

const ConversationContext = createContext<ConversationContextValue>({
  conversationId: null,
  conversationStateId: null,
  userId: null,
});

interface Props {
  userId: string | null | undefined;
  conversationId: string | null | undefined;
  conversationStateId: string | null | undefined;
  children: preact.ComponentChildren;
}

export function ConversationProvider({
  userId,
  conversationId,
  conversationStateId,
  children,
}: Props) {
  return (
    <ConversationContext.Provider
      value={{
        conversationId: conversationId ?? null,
        conversationStateId: conversationStateId ?? null,
        userId: userId ?? null,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

/**
 * Hook to access conversation context (userId, conversationId, conversationStateId)
 * Use this in any component that needs to make API calls with user/conversation context
 */
export function useConversation(): ConversationContextValue {
  return useContext(ConversationContext);
}
