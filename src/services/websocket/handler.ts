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
import { verifyJWT } from "../jwt";
import logger from "../../utils/logger";

// Track connected clients by conversation
const conversationClients = new Map<string, Set<any>>();

// Track user's allowed conversations (cache)
const userConversationAccess = new Map<string, Set<string>>();

// Track pending authentication timeouts
const authTimeouts = new Map<any, ReturnType<typeof setTimeout>>();

// Authentication timeout in milliseconds (10 seconds)
const AUTH_TIMEOUT_MS = 10000;

/**
 * WebSocket handler for Elysia
 *
 * Handles:
 * - Authentication via first message (not query string for security)
 * - Subscription to conversation channels
 * - Ping/pong heartbeat
 */
export const websocketHandler = new Elysia().ws("/api/ws", {
  // Handle connection open
  async open(ws) {
    // Initialize connection state - NOT authenticated yet
    (ws.data as any).userId = null;
    (ws.data as any).subscriptions = new Set<string>();

    // Set authentication timeout - close if not authenticated within timeout
    const timeout = setTimeout(() => {
      if (!(ws.data as any).userId) {
        logger.warn("ws_auth_timeout");
        ws.send(JSON.stringify({ type: "error", message: "Authentication timeout" }));
        ws.close(4001, "Authentication timeout");
      }
      authTimeouts.delete(ws);
    }, AUTH_TIMEOUT_MS);

    authTimeouts.set(ws, timeout);

    // Send ready message to indicate client should send auth
    ws.send(JSON.stringify({ type: "ready", message: "Send auth message with JWT token" }));

    logger.info("ws_client_connected_awaiting_auth");
  },

  // Handle incoming messages
  async message(ws, message) {
    try {
      const data = typeof message === "string" ? JSON.parse(message) : message;

      // Handle authentication first
      if (data.action === "auth") {
        const authMode = process.env.AUTH_MODE || "none";

        if (authMode === "none" && data.userId) {
          // Dev mode: accept userId directly (no JWT required)
          (ws.data as any).userId = data.userId;

          // Clear auth timeout
          const timeout = authTimeouts.get(ws);
          if (timeout) {
            clearTimeout(timeout);
            authTimeouts.delete(ws);
          }

          ws.send(JSON.stringify({ type: "authenticated", userId: data.userId }));
          logger.info({ userId: data.userId }, "ws_client_authenticated_dev_mode");
          return;
        } else if (data.token) {
          // Production mode: verify JWT
          const result = await verifyJWT(data.token);
          if (result.valid && result.payload) {
            (ws.data as any).userId = result.payload.sub;

            // Clear auth timeout
            const timeout = authTimeouts.get(ws);
            if (timeout) {
              clearTimeout(timeout);
              authTimeouts.delete(ws);
            }

            ws.send(JSON.stringify({ type: "authenticated", userId: result.payload.sub }));
            logger.info({ userId: result.payload.sub }, "ws_client_authenticated");
            return;
          } else {
            ws.send(JSON.stringify({ type: "error", message: result.error || "Invalid token" }));
            return;
          }
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Missing credentials" }));
          return;
        }
      }

      const userId = (ws.data as any).userId;

      // Reject if not authenticated
      if (!userId) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated. Send auth message first." }));
        return;
      }

      switch (data.action) {
        case "subscribe": {
          const { conversationId } = data;
          if (!conversationId) return;

          // Check if user has access to this conversation
          let allowedConversations = userConversationAccess.get(userId);

          // If cache is empty, try to refresh it
          if (!allowedConversations || allowedConversations.size === 0) {
            try {
              const { getUserConversations } = await import("../../db/operations");
              const userConversations = await getUserConversations(userId);
              allowedConversations = new Set(userConversations.map((c: any) => c.id));
              userConversationAccess.set(userId, allowedConversations);
            } catch (err) {
              logger.warn({ err, userId }, "ws_failed_to_refresh_conversations");
            }
          }

          // Validate access (if we have the list)
          if (allowedConversations && allowedConversations.size > 0) {
            if (!allowedConversations.has(conversationId)) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Access denied to conversation",
                }),
              );
              return;
            }
          }

          // Add to conversation room
          if (!conversationClients.has(conversationId)) {
            conversationClients.set(conversationId, new Set());
          }
          conversationClients.get(conversationId)!.add(ws);
          (ws.data as any).subscriptions.add(conversationId);

          ws.send(
            JSON.stringify({
              type: "subscribed",
              conversationId,
            }),
          );

          logger.info({ userId, conversationId }, "ws_client_subscribed");
          break;
        }

        case "unsubscribe": {
          const { conversationId } = data;
          if (!conversationId) return;

          conversationClients.get(conversationId)?.delete(ws);
          (ws.data as any).subscriptions.delete(conversationId);

          ws.send(
            JSON.stringify({
              type: "unsubscribed",
              conversationId,
            }),
          );

          logger.info({ userId, conversationId }, "ws_client_unsubscribed");
          break;
        }

        case "ping": {
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        }
      }
    } catch (e) {
      // Ignore invalid messages
      logger.warn({ error: e }, "ws_invalid_message");
    }
  },

  // Handle connection close
  close(ws) {
    const userId = (ws.data as any).userId;
    const subscriptions = (ws.data as any).subscriptions as Set<string> | undefined;

    // Clean up all subscriptions
    if (subscriptions) {
      for (const conversationId of subscriptions) {
        conversationClients.get(conversationId)?.delete(ws);
      }
    }

    // Clean up user access cache
    if (userId) {
      userConversationAccess.delete(userId);
    }

    logger.info({ userId }, "ws_client_disconnected");
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
    } catch (e) {
      errorCount++;
      // Client disconnected, will be cleaned up
    }
  }

  if (successCount > 0 || errorCount > 0) {
    logger.info(
      { conversationId, successCount, errorCount },
      "ws_broadcast_completed",
    );
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
 * Clean up dead connections periodically
 * Call this from a setInterval in the main server
 */
export function cleanupDeadConnections() {
  for (const [conversationId, clients] of conversationClients) {
    for (const client of clients) {
      // Check if client is still connected (readyState 1 = OPEN)
      if ((client as any).readyState !== 1) {
        clients.delete(client);
      }
    }
    if (clients.size === 0) {
      conversationClients.delete(conversationId);
    }
  }
}
