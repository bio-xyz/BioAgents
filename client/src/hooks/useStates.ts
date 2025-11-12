import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';

export interface ToolState {
  start: number;
  end?: number;
}

export interface StateValues {
  steps: Record<string, ToolState>;
  source: string;
  userId: string;
  conversationId: string;
  thought?: string;
  finalResponse?: string;
}

export interface State {
  id: string;
  values: StateValues;
  created_at: string;
  updated_at: string;
}

export interface UseStatesReturn {
  currentState: State | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Custom hook for subscribing to real-time state updates from Supabase
 * Listens to the states table for tool execution progress
 */
export function useStates(userId: string, conversationId: string): UseStatesReturn {
  const [currentState, setCurrentState] = useState<State | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !conversationId) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    // Fetch the latest state for this conversation
    async function fetchLatestState() {
      try {
        setIsLoading(true);
        const { data, error: fetchError } = await supabase
          .from('states')
          .select('*')
          .eq('values->>conversationId', conversationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
          throw fetchError;
        }

        if (mounted && data) {
          console.log('[useStates] Fetched state:', data);
          setCurrentState(data as State);
          setError(null);
        }
      } catch (err) {
        console.error('[useStates] Error fetching state:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch state');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    fetchLatestState();

    // Subscribe to real-time updates
    const channel = supabase
      .channel(`states:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'states',
        },
        (payload) => {
          console.log('[useStates] State INSERT:', payload);
          const newState = payload.new as State;

          // Only update if this state is for the current conversation
          // Note: We don't filter by userId because x402 external agents use a system userId
          if (newState.values?.conversationId === conversationId) {
            console.log('[useStates] Setting new state from INSERT');
            setCurrentState(newState);
            setError(null);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'states',
        },
        (payload) => {
          console.log('[useStates] State UPDATE:', payload);
          const updatedState = payload.new as State;

          // Only update if this state is for the current conversation
          // Note: We don't filter by userId because x402 external agents use a system userId
          if (updatedState.values?.conversationId === conversationId) {
            console.log('[useStates] ✅ Setting updated state from UPDATE');
            setCurrentState(updatedState);
            setError(null);
          } else {
            console.log('[useStates] ❌ Skipping UPDATE - wrong conversation');
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId, conversationId]);

  return {
    currentState,
    isLoading,
    error,
  };
}
