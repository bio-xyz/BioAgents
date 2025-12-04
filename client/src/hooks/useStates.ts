import { useEffect, useState } from "preact/hooks";
import { supabase, getConversationState } from "../lib/supabase";

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
  edisonResults?: Array<EdisonResult>;
  dataAnalysisResults?: Array<DataAnalysisResult>;
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
}

export type EdisonResult = {
  taskId: string;
  jobType: string;
  question: string;
  answer?: string;
  error?: string;
};

export type DataAnalysisResult = {
  id: string;
  status: string;
  success: boolean;
  answer: string;
  artifacts: Array<{
    id: string;
    description: string;
    content: string;
    filename: string;
    path?: string;
  }>;
  question?: string;
};

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

  // Reset states when conversation changes
  useEffect(() => {
    console.log("[useStates] Conversation changed, resetting states:", conversationId);
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
          .contains("values", { conversationId })
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
            console.log("[useStates] No message state found for conversation:", conversationId);
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
              console.log("[useStates] No conversation state found for:", conversationId);
              setConversationState(null);
            }
          }
        } catch (convErr) {
          console.log("[useStates] Error fetching conversation state:", convErr);
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
            console.error("[useStates] Error refetching conversation state:", err);
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
          if (conversationState && conversationState.id === updatedConvState.id) {
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
              console.error("[useStates] Error refetching conversation state:", err);
            }
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(statesChannel);
      supabase.removeChannel(convStatesChannel);
    };
  }, [userId, conversationId]);

  return {
    currentState,
    conversationState,
    isLoading,
    error,
  };
}
