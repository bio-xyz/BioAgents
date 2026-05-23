import type { ConversationState, State } from "../../types/core";

type DeepResearchStartFailureLogger = {
  error: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
};

export type DeepResearchStartFailureDeps = {
  clearDeepResearchActivity: (values: ConversationState["values"]) => void;
  ensureObjectiveTrace: (
    values: ConversationState["values"],
    objective?: string,
    options?: { runRootMessageId?: string }
  ) => Promise<unknown>;
  getObjectiveTraceObjective: (
    values: ConversationState["values"],
    fallbackObjective?: string
  ) => string | undefined;
  markMessageFailed: (messageId: string) => Promise<void>;
  markObjectiveTraceStale: (values: ConversationState["values"]) => unknown;
  updateConversationState: (id: string, values: ConversationState["values"]) => Promise<unknown>;
  notifyStateUpdated: (jobId: string, conversationId: string, stateId: string) => Promise<unknown>;
  updateState: (id: string, values: Record<string, unknown>) => Promise<unknown>;
  markRunFinished: (params: {
    conversationStateId: string;
    result: "failed";
    error?: string;
    rootMessageId?: string;
    stateId?: string;
  }) => Promise<unknown>;
  logger: DeepResearchStartFailureLogger;
};

export type DeepResearchStartFailureParams = {
  activeConversationState: ConversationState | null;
  activeMessageId?: string;
  conversationId: string;
  conversationStateId: string;
  err: unknown;
  notificationJobId: string;
  rootMessageId: string;
  stateRecord: {
    id: string;
    values: State["values"];
  };
};

export async function handleDeepResearchStartFailure(
  params: DeepResearchStartFailureParams,
  deps: DeepResearchStartFailureDeps
): Promise<void> {
  const {
    activeConversationState,
    activeMessageId,
    conversationId,
    conversationStateId,
    err,
    notificationJobId,
    rootMessageId,
    stateRecord,
  } = params;

  const errorMessage = err instanceof Error ? err.message : "Unknown error";

  if (activeConversationState?.id) {
    try {
      deps.clearDeepResearchActivity(activeConversationState.values);
      await deps.ensureObjectiveTrace(
        activeConversationState.values,
        deps.getObjectiveTraceObjective(activeConversationState.values),
        {
          runRootMessageId: rootMessageId,
        }
      );
      deps.markObjectiveTraceStale(activeConversationState.values);
      await deps.updateConversationState(
        activeConversationState.id,
        activeConversationState.values
      );
      await deps.notifyStateUpdated(notificationJobId, conversationId, activeConversationState.id);
    } catch (cleanupErr) {
      deps.logger.error(
        {
          cleanupErr,
          conversationStateId,
          messageId: notificationJobId,
          originalErr: err,
          rootMessageId,
        },
        "deep_research_error_cleanup_failed"
      );
    }
  }

  try {
    await deps.updateState(stateRecord.id, {
      ...stateRecord.values,
      error: errorMessage,
      status: "failed",
    });
  } catch (updateErr) {
    deps.logger.error({ updateErr }, "deep_research_update_state_on_failure_failed");
  }

  try {
    await deps.markMessageFailed(rootMessageId);
  } catch (msgErr) {
    deps.logger.warn({ msgErr, rootMessageId }, "deep_research_mark_message_failed_on_failure");
  }

  // If auto-continuation created a new message row before the failure, mark
  // that row FAILED too. markMessageFailed guards .neq("status", "COMPLETE")
  // so calling it on an already-completed root is safe.
  if (activeMessageId && activeMessageId !== rootMessageId) {
    try {
      await deps.markMessageFailed(activeMessageId);
    } catch (msgErr) {
      deps.logger.warn(
        { activeMessageId, msgErr },
        "deep_research_mark_continuation_message_failed_on_failure"
      );
    }
  }

  try {
    await deps.markRunFinished({
      conversationStateId,
      error: errorMessage,
      result: "failed",
      rootMessageId,
      stateId: stateRecord.id,
    });
  } catch (finishError) {
    deps.logger.warn(
      {
        conversationStateId,
        finishError,
        rootMessageId,
        stateId: stateRecord.id,
      },
      "deep_research_run_finish_mark_failed_on_failure"
    );
  }
}
