/**
 * Redis Subscription for WebSocket Notifications
 *
 * Subscribes to Redis Pub/Sub channels to receive notifications from workers.
 * When a notification is received, it's broadcast to connected WebSocket clients.
 */

import { getSubscriber } from "../queue/connection";
import { broadcastToConversation } from "./handler";
import logger from "../../utils/logger";

let isSubscribed = false;

/**
 * Start Redis subscription for WebSocket notifications
 *
 * Subscribes to all conversation:* channels using pattern subscription.
 * When a message is received, broadcasts to connected WebSocket clients.
 */
export async function startRedisSubscription() {
  if (isSubscribed) {
    logger.warn("redis_subscription_already_started");
    return;
  }

  try {
    const subscriber = getSubscriber();

    // Subscribe to conversation channels using pattern
    await subscriber.psubscribe("conversation:*");

    subscriber.on("pmessage", (pattern, channel, message) => {
      try {
        // channel = "conversation:abc123"
        const conversationId = channel.split(":")[1];
        const notification = JSON.parse(message);

        // Broadcast to all WebSocket clients in this conversation
        broadcastToConversation(conversationId, notification);

        logger.info(
          {
            type: notification.type,
            jobId: notification.jobId,
            conversationId,
          },
          "redis_notification_received_and_broadcast",
        );
      } catch (e) {
        logger.error({ error: e, channel, message }, "redis_message_processing_failed");
      }
    });

    isSubscribed = true;
    logger.info("redis_subscription_started");
  } catch (error) {
    logger.error({ error }, "redis_subscription_failed");
    throw error;
  }
}

/**
 * Stop Redis subscription
 */
export async function stopRedisSubscription() {
  if (!isSubscribed) {
    return;
  }

  try {
    const subscriber = getSubscriber();
    await subscriber.punsubscribe("conversation:*");
    isSubscribed = false;
    logger.info("redis_subscription_stopped");
  } catch (error) {
    logger.error({ error }, "redis_unsubscribe_failed");
  }
}

/**
 * Check if Redis subscription is active
 */
export function isRedisSubscriptionActive(): boolean {
  return isSubscribed;
}
