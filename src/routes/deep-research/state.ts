import { Elysia } from "elysia";
import { getConversation, getConversationState } from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import logger from "../../utils/logger";

/**
 * Deep Research State Route - Get conversation state for a conversation
 * Used by autonomous orchestrators to evaluate research progress
 */
export const deepResearchStateRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: process.env.NODE_ENV === "production",
      }),
    ],
  },
  (app) =>
    app.get(
      "/api/deep-research/conversations/:conversationId/state",
      async ({ params, set }) => {
        const { conversationId } = params;

        if (!conversationId) {
          set.status = 400;
          return {
            ok: false,
            error: "Missing required parameter: conversationId",
          };
        }

        try {
          // Get the conversation to find the conversation_state_id
          const conversation = await getConversation(conversationId);

          if (!conversation) {
            set.status = 404;
            return {
              ok: false,
              error: "Conversation not found",
            };
          }

          if (!conversation.conversation_state_id) {
            // No state yet - return empty state
            return {
              id: null,
              values: {
                objective: "",
              },
            };
          }

          // Get the conversation state
          const state = await getConversationState(
            conversation.conversation_state_id
          );

          if (!state) {
            set.status = 404;
            return {
              ok: false,
              error: "Conversation state not found",
            };
          }

          logger.info(
            {
              conversationId,
              stateId: state.id,
              hasDiscoveries: !!state.values?.discoveries?.length,
              hasHypothesis: !!state.values?.currentHypothesis,
            },
            "conversation_state_fetched"
          );

          return {
            id: state.id,
            values: state.values,
          };
        } catch (err) {
          logger.error({ err, conversationId }, "get_conversation_state_failed");
          set.status = 500;
          return {
            ok: false,
            error: "Failed to get conversation state",
          };
        }
      }
    )
);
