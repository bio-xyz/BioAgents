import { useEffect, useRef, useState, useCallback } from "preact/hooks";

export interface WebSocketMessage {
  type: string;
  conversationId?: string;
  messageId?: string;
  stateId?: string;
  jobId?: string;
  progress?: { stage: string; percent: number };
  error?: string;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  subscribe: (conversationId: string) => void;
  unsubscribe: (conversationId: string) => void;
}

/**
 * WebSocket hook for real-time notifications from the backend
 * Uses the "Notify + Fetch" pattern - receives lightweight notifications
 * and triggers refetch of actual data
 *
 * @param userId - User ID for authentication (required for dev mode)
 * @param onMessageUpdated - Callback when message is updated
 * @param onStateUpdated - Callback when state is updated
 */
export function useWebSocket(
  userId: string | null,
  onMessageUpdated?: (messageId: string, conversationId: string) => void,
  onStateUpdated?: (stateId: string, conversationId: string) => void,
): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const userIdRef = useRef(userId);

  // Use refs for callbacks to avoid stale closures in WebSocket handlers
  const onMessageUpdatedRef = useRef(onMessageUpdated);
  const onStateUpdatedRef = useRef(onStateUpdated);

  // Keep refs updated
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    onMessageUpdatedRef.current = onMessageUpdated;
  }, [onMessageUpdated]);

  useEffect(() => {
    onStateUpdatedRef.current = onStateUpdated;
  }, [onStateUpdated]);

  const connect = useCallback(() => {
    // Don't connect without userId
    if (!userIdRef.current) {
      console.log("[WebSocket] No userId, skipping connection");
      return;
    }

    // Don't reconnect if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Build WebSocket URL (same host, /api/ws path)
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;

    console.log("[WebSocket] Connecting to:", wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WebSocket] Connected, authenticating...");
        // Send auth message with userId (dev mode)
        ws.send(JSON.stringify({ action: "auth", userId: userIdRef.current }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          // Handle authentication response
          if (message.type === "authenticated") {
            console.log("[WebSocket] Authenticated successfully");
            setIsConnected(true);

            // Re-subscribe to any pending subscriptions
            for (const conversationId of subscriptionsRef.current) {
              ws.send(JSON.stringify({ action: "subscribe", conversationId }));
            }
            return;
          }

          if (message.type === "ready") {
            // Server is ready, send auth
            ws.send(JSON.stringify({ action: "auth", userId: userIdRef.current }));
            return;
          }

          if (message.type === "error") {
            console.warn("[WebSocket] Error:", message);
            return;
          }

          // Handle notification types
          switch (message.type) {
            case "message:updated":
              if (message.messageId && message.conversationId) {
                onMessageUpdatedRef.current?.(message.messageId, message.conversationId);
              }
              break;

            case "state:updated":
              if (message.stateId && message.conversationId) {
                onStateUpdatedRef.current?.(message.stateId, message.conversationId);
              }
              break;

            case "job:completed":
              console.log("[WebSocket] Job completed:", message.jobId);
              // Note: Don't trigger onMessageUpdated here - the worker already sends
              // message:updated notification. Triggering both causes duplicate messages.
              break;

            case "job:started":
            case "job:progress":
              // Can be used for progress indicators
              console.log("[WebSocket] Job progress:", message.type, message.progress);
              break;
          }
        } catch (err) {
          console.warn("[WebSocket] Failed to parse message:", err);
        }
      };

      ws.onclose = (event) => {
        console.log("[WebSocket] Disconnected:", event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect after 3 seconds (unless it was a normal close)
        if (event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("[WebSocket] Reconnecting...");
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };
    } catch (err) {
      console.error("[WebSocket] Failed to create connection:", err);
    }
  }, []); // No dependencies - refs are used for callbacks to avoid stale closures

  // Connect when userId is available
  useEffect(() => {
    if (userId) {
      connect();
    }

    // Ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "ping" }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [userId, connect]);

  const subscribe = useCallback((conversationId: string) => {
    subscriptionsRef.current.add(conversationId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "subscribe", conversationId }));
      console.log("[WebSocket] Subscribed to:", conversationId);
    }
  }, []);

  const unsubscribe = useCallback((conversationId: string) => {
    subscriptionsRef.current.delete(conversationId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "unsubscribe", conversationId }));
      console.log("[WebSocket] Unsubscribed from:", conversationId);
    }
  }, []);

  return {
    isConnected,
    lastMessage,
    subscribe,
    unsubscribe,
  };
}
