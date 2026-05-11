import { Elysia } from "elysia";
import { cancelBioLiteratureJob } from "../../agents/literature/bio";
import {
  getConversation,
  getConversationState,
  getMessage,
  getState,
  updateConversationState,
  updateState,
} from "../../db/operations";
import { authResolver } from "../../middleware/authResolver";
import { markMessageFailed } from "../../services/chat/tools";
import {
  collectBioLiteratureJobIds,
  markDeepResearchCancelledValues,
} from "../../services/deep-research/cancellation";
import { isJobQueueEnabled } from "../../services/queue/connection";
import { notifyStateUpdated } from "../../services/queue/notify";
import { getDeepResearchQueue } from "../../services/queue/queues";
import type { ElysiaRouteContext } from "../../types/elysia";
import logger from "../../utils/logger";

type CancelResponse = {
  status: "cancelled";
  messageId: string;
  conversationId: string;
  removedQueueJob?: boolean;
  downstreamCancelRequested?: number;
};

export const deepResearchCancelRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({
        required: true,
      }),
    ],
  },
  (app) => app.post("/api/deep-research/cancel/:messageId", deepResearchCancelHandler)
);

export async function deepResearchCancelHandler(ctx: ElysiaRouteContext<{ messageId: string }>) {
  const { params, request, set } = ctx;
  const { messageId } = params;
  const auth = request.auth;

  if (!auth?.userId) {
    set.status = 401;
    return {
      error: "Authentication required",
      message: "Please provide a valid JWT or API key",
      ok: false,
    };
  }

  if (!messageId) {
    set.status = 400;
    return {
      error: "Missing required parameter: messageId",
      ok: false,
    };
  }

  const message = await getMessage(messageId);
  if (!message) {
    set.status = 404;
    return { error: "Message not found", ok: false };
  }

  if (message.user_id !== auth.userId) {
    logger.warn(
      { messageId, ownedBy: message.user_id, requestedBy: auth.userId },
      "deep_research_cancel_ownership_mismatch"
    );
    set.status = 403;
    return { error: "Access denied: message belongs to another user", ok: false };
  }

  const stateId = message.state_id;
  if (!stateId) {
    set.status = 500;
    return { error: "Message has no associated state", ok: false };
  }

  const [state, conversation] = await Promise.all([
    getState(stateId),
    getConversation(message.conversation_id),
  ]);
  if (!state) {
    set.status = 404;
    return { error: "State not found", ok: false };
  }
  if (!conversation?.conversation_state_id) {
    set.status = 404;
    return { error: "Conversation state not found", ok: false };
  }

  const conversationState = await getConversationState(conversation.conversation_state_id);
  if (!conversationState) {
    set.status = 404;
    return { error: "Conversation state not found", ok: false };
  }

  const cancelledConversationValues = markDeepResearchCancelledValues(conversationState.values);
  const cancelledStateValues = {
    ...(state.values || {}),
    status: "cancelled",
  };

  let removedQueueJob = false;
  const activeRun = conversationState.values?.deepResearchRun;
  if (isJobQueueEnabled()) {
    const queue = getDeepResearchQueue();
    const queueJobId = activeRun?.jobId || messageId;
    const job = await queue.getJob(queueJobId);
    if (job) {
      const jobState = await job.getState();
      if (["waiting", "delayed", "prioritized", "waiting-children", "paused"].includes(jobState)) {
        await job.remove();
        removedQueueJob = true;
      }
    }
  }

  await Promise.all([
    markMessageFailed(messageId),
    updateConversationState(conversationState.id, cancelledConversationValues),
    updateState(stateId, cancelledStateValues),
  ]);

  try {
    await notifyStateUpdated(
      activeRun?.jobId || `cancel-${messageId}`,
      message.conversation_id,
      conversationState.id
    );
  } catch (error) {
    logger.warn({ error, messageId }, "deep_research_cancel_notify_failed");
  }

  const bioLiteratureJobIds = collectBioLiteratureJobIds(cancelledConversationValues);
  const downstreamResults = await Promise.allSettled(
    bioLiteratureJobIds.map((jobId) => cancelBioLiteratureJob(jobId))
  );
  const downstreamCancelRequested = downstreamResults.filter(
    (result) => result.status === "fulfilled" && result.value
  ).length;

  logger.info(
    {
      downstreamCancelRequested,
      messageId,
      removedQueueJob,
      userId: auth.userId,
    },
    "deep_research_cancelled"
  );

  const response: CancelResponse = {
    conversationId: message.conversation_id,
    downstreamCancelRequested,
    messageId,
    removedQueueJob,
    status: "cancelled",
  };
  return response;
}
