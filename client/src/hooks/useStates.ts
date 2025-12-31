import { useEffect, useRef, useState } from "preact/hooks";
import { getConversationState, supabase } from "../lib/supabase";

export interface ToolState {
  start: number;
  end?: number;
}

export interface StateValues {
  steps: Record<string, ToolState>;
  source: string;
  userId: string;
  conversationId: string;
  messageId?: string;
  thought?: string;
  finalResponse?: string;
  isDeepResearch?: boolean;
  // Research state fields (from conversation_states)
  plan?: Array<any>;
  discoveries?: string[];
  keyInsights?: string[];
  methodology?: string;
  currentLevel?: number;
  currentObjective?: string;
  uploadedDatasets?: Array<any>;
  currentHypothesis?: string;
  suggestedNextSteps?: Array<any>;
}

export interface State {
  id: string;
  values: StateValues;
  created_at: string;
  updated_at: string;
}

export interface ConversationState {
  id: string;
  values: {
    plan?: Array<any>;
    discoveries?: string[];
    keyInsights?: string[];
    methodology?: string;
    currentLevel?: number;
    currentObjective?: string;
    uploadedDatasets?: Array<any>;
    currentHypothesis?: string;
    suggestedNextSteps?: Array<any>;
  };
  created_at: string;
  updated_at: string;
}

export interface UseStatesReturn {
  currentState: State | null;
  conversationState: ConversationState | null;
  isLoading: boolean;
  error: string | null;
  refetchConversationState: () => Promise<void>;
}

/**
 * Custom hook for subscribing to real-time state updates from Supabase
 * Listens to the states table for tool execution progress
 * Also fetches and subscribes to conversation_states for persistent research state
 */
export function useStates(
  userId: string,
  conversationId: string,
): UseStatesReturn {
  const [currentState, setCurrentState] = useState<State | null>(null);
  const [conversationState, setConversationState] =
    useState<ConversationState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ref to track current conversation state values for polling comparison
  // (avoids stale closure issue in setInterval)
  const conversationStateRef = useRef<ConversationState | null>(null);
  useEffect(() => {
    conversationStateRef.current = conversationState;
  }, [conversationState]);

  // Reset states when conversation changes
  useEffect(() => {
    console.log(
      "[useStates] Conversation changed, resetting states:",
      conversationId,
    );
    setCurrentState(null);
    setConversationState(null);
    setError(null);
  }, [conversationId]);

  useEffect(() => {
    if (!userId || !conversationId) {
      setIsLoading(false);
      setCurrentState(null);
      setConversationState(null);
      return;
    }

    let mounted = true;

    // Fetch the latest state for this conversation
    async function fetchLatestState() {
      try {
        setIsLoading(true);

        // Fetch message-level state (for thinking steps, etc.)
        const { data, error: fetchError } = await supabase
          .from("states")
          .select("*")
          .eq("values->>conversationId", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (fetchError && fetchError.code !== "PGRST116") {
          // PGRST116 = no rows returned
          throw fetchError;
        }

        if (mounted) {
          if (data) {
            console.log("[useStates] Fetched message state:", data);
            setCurrentState(data as State);
            setError(null);
          } else {
            console.log(
              "[useStates] No message state found for conversation:",
              conversationId,
            );
            setCurrentState(null);
          }
        }

        // Fetch conversation-level state (for research state - hypothesis, insights, etc.)
        try {
          const convState = await getConversationState(conversationId);
          if (mounted) {
            if (convState) {
              console.log("[useStates] Fetched conversation state:", convState);
              setConversationState(convState as ConversationState);
            } else {
              console.log(
                "[useStates] No conversation state found for:",
                conversationId,
              );
              setConversationState(null);
            }
          }
        } catch (convErr) {
          console.log(
            "[useStates] Error fetching conversation state:",
            convErr,
          );
          if (mounted) {
            setConversationState(null);
          }
        }
      } catch (err) {
        console.error("[useStates] Error fetching state:", err);
        if (mounted) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch state",
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    fetchLatestState();

    // Polling for state updates - polls every 2 seconds
    // This is essential for research state updates in both queue mode and in-process mode
    let pollCount = 0;
    const maxPolls = 900; // 30 minutes max polling (900 * 2s)

    const pollForState = async () => {
      if (!mounted || pollCount >= maxPolls) return;
      pollCount++;

      try {
        // Poll for conversation state updates (research state)
        const convState = await getConversationState(conversationId);
        if (mounted && convState) {
          // Only update if values changed (use ref to avoid stale closure)
          const currentValues = JSON.stringify(conversationStateRef.current?.values || {});
          const newValues = JSON.stringify(convState.values || {});
          if (currentValues !== newValues) {
            console.log("[useStates Polling] Conversation state updated!", {
              hadPrevious: !!conversationStateRef.current,
              newKeys: Object.keys(convState.values || {}),
            });
            setConversationState(convState as ConversationState);
          }
        }
      } catch (err) {
        // Silently ignore polling errors
      }
    };

    // Poll immediately on mount, then every 2 seconds
    pollForState();
    const pollInterval = setInterval(pollForState, 2000);

    // Subscribe to real-time updates for message states
    const statesChannel = supabase
      .channel(`states:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "states",
        },
        (payload) => {
          console.log("[useStates] State INSERT:", payload);
          const newState = payload.new as State;

          // Only update if this state is for the current conversation
          // Note: We don't filter by userId because x402 external agents use a system userId
          if (newState.values?.conversationId === conversationId) {
            console.log("[useStates] Setting new state from INSERT");
            setCurrentState(newState);
            setError(null);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "states",
        },
        (payload) => {
          console.log("[useStates] State UPDATE:", payload);
          const updatedState = payload.new as State;

          // Only update if this state is for the current conversation
          // Note: We don't filter by userId because x402 external agents use a system userId
          if (updatedState.values?.conversationId === conversationId) {
            console.log("[useStates] ✅ Setting updated state from UPDATE");
            setCurrentState(updatedState);
            setError(null);
          } else {
            console.log("[useStates] ❌ Skipping UPDATE - wrong conversation");
          }
        },
      )
      .subscribe();

    // Subscribe to real-time updates for conversation states
    const convStatesChannel = supabase
      .channel(`conversation_states:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_states",
        },
        async (payload) => {
          console.log("[useStates] ConversationState INSERT:", payload);
          // Re-fetch to get the linked state
          try {
            const convState = await getConversationState(conversationId);
            if (convState) {
              console.log(
                "[useStates] Updated conversation state from INSERT:",
                convState,
              );
              setConversationState(convState as ConversationState);
            }
          } catch (err) {
            console.error(
              "[useStates] Error refetching conversation state:",
              err,
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_states",
        },
        async (payload) => {
          console.log("[useStates] ConversationState UPDATE:", payload);
          const updatedConvState = payload.new as ConversationState;

          // Check if this is our conversation's state
          if (
            conversationState &&
            conversationState.id === updatedConvState.id
          ) {
            console.log(
              "[useStates] ✅ Setting updated conversation state from UPDATE",
            );
            setConversationState(updatedConvState);
          } else {
            // If we don't have the conversation state yet, fetch it
            try {
              const convState = await getConversationState(conversationId);
              if (convState && convState.id === updatedConvState.id) {
                console.log(
                  "[useStates] ✅ Fetched and set conversation state from UPDATE",
                );
                setConversationState(convState as ConversationState);
              }
            } catch (err) {
              console.error(
                "[useStates] Error refetching conversation state:",
                err,
              );
            }
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(pollInterval);
      supabase.removeChannel(statesChannel);
      supabase.removeChannel(convStatesChannel);
    };
  }, [userId, conversationId]);

  // Manual refetch function for WebSocket-triggered updates
  const refetchConversationState = async () => {
    try {
      console.log("[useStates] Manual refetch triggered");
      const convState = await getConversationState(conversationId);
      if (convState) {
        console.log("[useStates] Refetched conversation state:", convState.id);
        setConversationState(convState as ConversationState);
      }
    } catch (err) {
      console.error("[useStates] Error refetching conversation state:", err);
    }
  };

  return {
    currentState,
    conversationState,
    isLoading,
    error,
    refetchConversationState,
  };
}
