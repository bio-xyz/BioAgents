import { createContext } from "preact";
import { useContext } from "preact/hooks";

interface ConversationContextValue {
  userId: string | null;
  conversationId: string | null;
  conversationStateId: string | null;
}

const ConversationContext = createContext<ConversationContextValue>({
  userId: null,
  conversationId: null,
  conversationStateId: null,
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
        userId: userId ?? null,
        conversationId: conversationId ?? null,
        conversationStateId: conversationStateId ?? null,
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
