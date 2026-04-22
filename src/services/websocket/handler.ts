/**
 * WebSocket Handler for Real-Time Notifications
 *
 * Implements the "Notify + Fetch" pattern:
 * - Lightweight notifications via WebSocket
 * - UI fetches actual data via HTTP after notification
 *
 * Authentication:
 * - JWT token sent as first message after connection: { action: "auth", token: "<jwt>" }
 * - Validates user ownership of conversations before subscription
 * - Unauthenticated connections are closed after AUTH_TIMEOUT_MS
 */

import { Elysia } from "elysia";
import logger from "../../utils/logger";
import { verifyJWT } from "../jwt";

interface WsClient {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState?: number;
}

interface WsConnectionState {
  userId: string | null;
  subscriptions: Set<string>;
}

// Per-connection state keyed by the websocket instance
const wsState = new WeakMap<WsClient, WsConnectionState>();

// Track connected clients by conversation
const conversationClients = new Map<string, Set<WsClient>>();

// Track user's allowed conversations (cache)
const userConversationAccess = new Map<string, Set<string>>();

// Track pending authentication timeouts
const authTimeouts = new WeakMap<WsClient, ReturnType<typeof setTimeout>>();

// Authentication timeout in milliseconds (10 seconds)
const AUTH_TIMEOUT_MS = 10000;

export function getState(ws: WsClient): WsConnectionState {
  let state = wsState.get(ws);
  if (!state) {
    state = { subscriptions: new Set(), userId: null };
    wsState.set(ws, state);
  }
  return state;
}

interface AuthMessage {
  action: "auth";
  token?: string;
  userId?: string;
}

interface SubscribeMessage {
  action: "subscribe" | "unsubscribe";
  conversationId?: string;
}

interface PingMessage {
  action: "ping";
}

type IncomingMessage = AuthMessage | SubscribeMessage | PingMessage;

export function parseIncomingMessage(raw: unknown): IncomingMessage | null {
  const data: unknown = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.action !== "string") return null;
  if (obj.action === "auth") {
    return {
      action: "auth",
      token: typeof obj.token === "string" ? obj.token : undefined,
      userId: typeof obj.userId === "string" ? obj.userId : undefined,
    };
  }
  if (obj.action === "subscribe" || obj.action === "unsubscribe") {
    return {
      action: obj.action,
      conversationId: typeof obj.conversationId === "string" ? obj.conversationId : undefined,
    };
  }
  if (obj.action === "ping") {
    return { action: "ping" };
  }
  return null;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * WebSocket handler for Elysia
 *
 * Handles:
 * - Authentication via first message (not query string for security)
 * - Subscription to conversation channels
 * - Ping/pong heartbeat
 */
export const websocketHandler = new Elysia().ws("/api/ws", {
  // Handle connection close
  close(ws) {
    const client: WsClient = ws;
    const state = wsState.get(client);

    // Clean up all subscriptions
    if (state) {
      for (const conversationId of state.subscriptions) {
        conversationClients.get(conversationId)?.delete(client);
      }
    }

    // Clean up user access cache
    if (state?.userId) {
      userConversationAccess.delete(state.userId);
    }

    wsState.delete(client);

    logger.info({ userId: state?.userId }, "ws_client_disconnected");
  },

  // Handle incoming messages
  async message(ws, message) {
    const client: WsClient = ws;
    try {
      const data = parseIncomingMessage(message);
      if (!data) return;

      // Handle authentication first
      if (data.action === "auth") {
        const authMode = process.env.AUTH_MODE || "none";

        if (authMode === "none" && data.userId) {
          getState(client).userId = data.userId;

          const timeout = authTimeouts.get(client);
          if (timeout) {
            clearTimeout(timeout);
            authTimeouts.delete(client);
          }

          client.send(JSON.stringify({ type: "authenticated", userId: data.userId }));
          logger.info({ userId: data.userId }, "ws_client_authenticated_dev_mode");
          return;
        } else if (data.token) {
          const result = await verifyJWT(data.token);
          if (result.valid && result.payload) {
            getState(client).userId = result.payload.sub;

            const timeout = authTimeouts.get(client);
            if (timeout) {
              clearTimeout(timeout);
              authTimeouts.delete(client);
            }

            client.send(JSON.stringify({ type: "authenticated", userId: result.payload.sub }));
            logger.info({ userId: result.payload.sub }, "ws_client_authenticated");
            return;
          } else {
            client.send(
              JSON.stringify({ message: result.error || "Invalid token", type: "error" })
            );
            return;
          }
        } else {
          client.send(JSON.stringify({ message: "Missing credentials", type: "error" }));
          return;
        }
      }

      const state = getState(client);
      const userId = state.userId;

      // Reject if not authenticated
      if (!userId) {
        client.send(
          JSON.stringify({ message: "Not authenticated. Send auth message first.", type: "error" })
        );
        return;
      }

      if (data.action === "subscribe") {
        const { conversationId } = data;
        if (!conversationId) return;

        // Check if user has access to this conversation
        let allowedConversations = userConversationAccess.get(userId);

        // If cache is empty, try to refresh it
        if (!allowedConversations || allowedConversations.size === 0) {
          try {
            const { getUserConversations } = await import("../../db/operations");
            const userConversations = await getUserConversations(userId);
            allowedConversations = new Set(
              userConversations
                .map((c) => c.id)
                .filter((id): id is string => typeof id === "string")
            );
            userConversationAccess.set(userId, allowedConversations);
          } catch (err) {
            logger.warn({ err, userId }, "ws_failed_to_refresh_conversations");
          }
        }

        // Validate access (if we have the list)
        if (allowedConversations && allowedConversations.size > 0) {
          if (!allowedConversations.has(conversationId)) {
            client.send(
              JSON.stringify({
                message: "Access denied to conversation",
                type: "error",
              })
            );
            return;
          }
        }

        // Add to conversation room
        let clients = conversationClients.get(conversationId);
        if (!clients) {
          clients = new Set();
          conversationClients.set(conversationId, clients);
        }
        clients.add(client);
        state.subscriptions.add(conversationId);

        client.send(
          JSON.stringify({
            conversationId,
            type: "subscribed",
          })
        );

        logger.info({ conversationId, userId }, "ws_client_subscribed");
        return;
      }

      if (data.action === "unsubscribe") {
        const { conversationId } = data;
        if (!conversationId) return;

        conversationClients.get(conversationId)?.delete(client);
        state.subscriptions.delete(conversationId);

        client.send(
          JSON.stringify({
            conversationId,
            type: "unsubscribed",
          })
        );

        logger.info({ conversationId, userId }, "ws_client_unsubscribed");
        return;
      }

      if (data.action === "ping") {
        client.send(JSON.stringify({ type: "pong" }));
        return;
      }
    } catch (e) {
      logger.warn({ error: e }, "ws_invalid_message");
    }
  },
  // Handle connection open
  async open(ws) {
    const client: WsClient = ws;
    getState(client); // initialize state

    // Set authentication timeout - close if not authenticated within timeout
    const timeout = setTimeout(() => {
      if (!getState(client).userId) {
        logger.warn("ws_auth_timeout");
        client.send(JSON.stringify({ message: "Authentication timeout", type: "error" }));
        client.close(4001, "Authentication timeout");
      }
      authTimeouts.delete(client);
    }, AUTH_TIMEOUT_MS);

    authTimeouts.set(client, timeout);

    // Send ready message to indicate client should send auth
    client.send(JSON.stringify({ message: "Send auth message with JWT token", type: "ready" }));

    logger.info("ws_client_connected_awaiting_auth");
  },
});

/**
 * Broadcast a message to all clients subscribed to a conversation
 */
export function broadcastToConversation(conversationId: string, message: object) {
  const clients = conversationClients.get(conversationId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  let successCount = 0;
  let errorCount = 0;

  for (const client of clients) {
    try {
      client.send(payload);
      successCount++;
    } catch {
      errorCount++;
      // Client disconnected, will be cleaned up
    }
  }

  if (successCount > 0 || errorCount > 0) {
    logger.info({ conversationId, errorCount, successCount }, "ws_broadcast_completed");
  }
}

/**
 * Get the number of connected clients for a conversation
 */
export function getConversationClientCount(conversationId: string): number {
  return conversationClients.get(conversationId)?.size || 0;
}

/**
 * Get total connected client count
 */
export function getTotalClientCount(): number {
  let total = 0;
  for (const clients of conversationClients.values()) {
    total += clients.size;
  }
  return total;
}

/**
 * Pure form of cleanupDeadConnections — mutates the map passed in. Exposed so
 * tests can seed a fresh map without touching module-level state.
 */
export function cleanupDeadConnectionsIn(clientsMap: Map<string, Set<WsClient>>): void {
  for (const [conversationId, clients] of clientsMap) {
    for (const client of clients) {
      // readyState 1 = OPEN. Anything else (including undefined for implementations
      // that don't expose it) is treated as dead so we don't leak connections.
      if (client.readyState !== 1) {
        clients.delete(client);
      }
    }
    if (clients.size === 0) {
      clientsMap.delete(conversationId);
    }
  }
}

/**
 * Clean up dead connections periodically
 * Call this from a setInterval in the main server
 */
export function cleanupDeadConnections() {
  cleanupDeadConnectionsIn(conversationClients);
}
