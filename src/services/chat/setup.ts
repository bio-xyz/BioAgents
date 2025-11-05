import {
  createConversation,
  createConversationState,
  createState,
  createUser,
  getConversation,
  getConversationState,
  updateConversation,
} from "../../db/operations";
import { createX402External } from "../../db/x402Operations";
import type { X402ExternalRecord } from "../../db/x402Operations";
import logger from "../../utils/logger";

// System user ID for x402 external agent conversations
export const X402_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export interface SetupResult {
  success: boolean;
  error?: string;
  isExternal?: boolean;
}

export interface ConversationSetup {
  conversationStateRecord: any;
  stateRecord: any;
  x402ExternalRecord?: X402ExternalRecord;
}

/**
 * Ensures user and conversation exist based on authentication method
 *
 * Auth-aware user creation strategy:
 * - Privy users (external_ui): Managed in Next.js UI, no backend user creation needed
 * - CDP users (dev_ui): Create user record if not exists
 * - External agents (x402_agent): Create conversation with system user for persistence
 */
export async function ensureUserAndConversation(
  userId: string,
  conversationId: string,
  authMethod?: "privy" | "cdp",
  source?: string,
): Promise<SetupResult> {
  // External agents (x402_agent): Create conversation with system user
  // This enables persistent multi-turn conversations for external agents
  if (source === "x402_agent") {
    try {
      await createConversation({
        id: conversationId,
        user_id: X402_SYSTEM_USER_ID,
      });
      if (logger) {
        logger.info(
          { conversationId, systemUserId: X402_SYSTEM_USER_ID },
          "x402_agent_conversation_created_with_system_user",
        );
      }
    } catch (err: any) {
      // Ignore duplicate key errors (conversation already exists)
      if (err.code !== "23505") {
        if (logger) {
          logger.error({ err, conversationId }, "create_conversation_failed");
        }
        return { success: false, error: "Failed to create conversation" };
      }
    }
    return { success: true, isExternal: true };
  }

  // Privy users (external_ui): Skip user creation (managed in Next.js UI)
  // CDP users (dev_ui): Create user if not exists
  if (authMethod !== "privy") {
    try {
      await createUser({
        id: userId,
        username: `user_${userId.slice(0, 8)}`,
        email: `${userId}@temp.local`,
      });
      if (logger) logger.info({ userId, authMethod }, "user_created");
    } catch (err: any) {
      // Ignore duplicate key errors (user already exists)
      if (err.code !== "23505") {
        if (logger) logger.error({ err, userId }, "create_user_failed");
        return { success: false, error: "Failed to create user" };
      }
    }
  } else {
    if (logger) {
      logger.info({ userId }, "privy_user_skipped_backend_user_creation");
    }
  }

  // Create conversation for both Privy and CDP users
  try {
    await createConversation({
      id: conversationId,
      user_id: userId,
    });
    if (logger) logger.info({ conversationId, userId }, "conversation_created");
  } catch (err: any) {
    // Ignore duplicate key errors (conversation already exists)
    if (err.code !== "23505") {
      if (logger) {
        logger.error({ err, conversationId }, "create_conversation_failed");
      }
      return { success: false, error: "Failed to create conversation" };
    }
  }

  return { success: true, isExternal: false };
}

/**
 * Setup conversation state, message state, and x402 external record
 */
export async function setupConversationData(
  conversationId: string,
  userId: string,
  source: string,
  isExternal: boolean,
  message: string,
  fileCount: number,
): Promise<{ success: boolean; data?: ConversationSetup; error?: string }> {
  let conversationStateRecord: any;
  let stateRecord: any;
  let x402ExternalRecord: X402ExternalRecord | undefined;

  // For external agents, create x402_external record upfront
  if (isExternal) {
    try {
      x402ExternalRecord = await createX402External({
        conversation_id: conversationId,
        request_path: "/api/chat",
        payment_status: "pending",
        request_metadata: {
          providedUserId: userId,
          messageLength: message.length,
          fileCount,
        },
      });
      if (logger) {
        logger.info(
          { x402ExternalId: x402ExternalRecord.id, conversationId },
          "x402_external_record_created",
        );
      }
    } catch (err) {
      if (logger) logger.error({ err }, "create_x402_external_failed");
      return { success: false, error: "Failed to create external request record" };
    }
  }

  // Get or create conversation state (skip for external agents)
  if (!isExternal) {
    try {
      const conversation = await getConversation(conversationId);

      if (conversation.conversation_state_id) {
        conversationStateRecord = await getConversationState(
          conversation.conversation_state_id,
        );
        if (logger) {
          logger.info(
            { conversationStateId: conversationStateRecord.id },
            "conversation_state_fetched",
          );
        }
      } else {
        conversationStateRecord = await createConversationState({
          values: {},
        });

        await updateConversation(conversationId, {
          conversation_state_id: conversationStateRecord.id,
        });

        if (logger) {
          logger.info(
            { conversationStateId: conversationStateRecord.id },
            "conversation_state_created",
          );
        }
      }
    } catch (err) {
      if (logger) {
        logger.error({ err }, "get_or_create_conversation_state_failed");
      }
      return {
        success: false,
        error: "Failed to get or create conversation state",
      };
    }
  } else {
    // For external agents, create a minimal conversation state (in-memory only)
    conversationStateRecord = {
      id: `temp_${conversationId}`,
      values: {},
    };
    if (logger) {
      logger.info(
        "x402_agent_using_temporary_conversation_state_no_persistence",
      );
    }
  }

  // Create initial state in DB (skip for external agents)
  if (!isExternal) {
    try {
      stateRecord = await createState({
        values: {
          conversationId,
          userId,
          source,
        },
      });
    } catch (err) {
      if (logger) logger.error({ err }, "create_state_failed");
      return { success: false, error: "Failed to create state" };
    }
  } else {
    // For external agents, create temporary state record
    stateRecord = {
      id: `temp_state_${conversationId}`,
      values: { conversationId, userId, source },
    };
    if (logger) {
      logger.info("x402_agent_using_temporary_state_no_persistence");
    }
  }

  return {
    success: true,
    data: {
      conversationStateRecord,
      stateRecord,
      x402ExternalRecord,
    },
  };
}
