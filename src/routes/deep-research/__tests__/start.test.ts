import { describe, expect, mock, test } from "bun:test";
import { handleDeepResearchStartFailure } from "../failure-handler";

const noop = async () => {};
const noopSync = () => {};

function makeMinimalDeps(
  overrides: Partial<Parameters<typeof handleDeepResearchStartFailure>[1]> = {}
) {
  return {
    clearDeepResearchActivity: noopSync,
    ensureObjectiveTrace: noop,
    getObjectiveTraceObjective: () => undefined,
    logger: { error: () => {}, warn: () => {} },
    markMessageFailed: noop,
    markObjectiveTraceStale: noopSync,
    markRunFinished: noop,
    notifyStateUpdated: noop,
    updateConversationState: noop,
    updateState: noop,
    ...overrides,
  };
}

const baseParams = {
  activeConversationState: null,
  conversationId: "conv-1",
  conversationStateId: "cs-1",
  err: new Error("boom"),
  notificationJobId: "in-process-msg-1",
  rootMessageId: "msg-root",
  stateRecord: { id: "state-1", values: {} as never },
};

describe("handleDeepResearchStartFailure", () => {
  test("marks rootMessageId FAILED", async () => {
    const markMessageFailed = mock(noop);
    const deps = makeMinimalDeps({ markMessageFailed });

    await handleDeepResearchStartFailure(baseParams, deps);

    expect(markMessageFailed).toHaveBeenCalledWith("msg-root");
  });

  test("marks activeMessageId FAILED when it differs from rootMessageId", async () => {
    const markMessageFailed = mock(noop);
    const deps = makeMinimalDeps({ markMessageFailed });

    await handleDeepResearchStartFailure(
      { ...baseParams, activeMessageId: "msg-continuation" },
      deps
    );

    expect(markMessageFailed).toHaveBeenCalledWith("msg-root");
    expect(markMessageFailed).toHaveBeenCalledWith("msg-continuation");
    expect(markMessageFailed).toHaveBeenCalledTimes(2);
  });

  test("does NOT mark activeMessageId when it equals rootMessageId", async () => {
    const markMessageFailed = mock(noop);
    const deps = makeMinimalDeps({ markMessageFailed });

    await handleDeepResearchStartFailure({ ...baseParams, activeMessageId: "msg-root" }, deps);

    expect(markMessageFailed).toHaveBeenCalledWith("msg-root");
    expect(markMessageFailed).toHaveBeenCalledTimes(1);
  });

  test("still marks rootMessageId FAILED when updateState throws", async () => {
    const markMessageFailed = mock(noop);
    const deps = makeMinimalDeps({
      markMessageFailed,
      updateState: async () => {
        throw new Error("DB down");
      },
    });

    await handleDeepResearchStartFailure(baseParams, deps);

    expect(markMessageFailed).toHaveBeenCalledWith("msg-root");
  });

  test("still marks continuation FAILED when rootMessageId mark throws", async () => {
    const markMessageFailed = mock(async (id: string) => {
      if (id === "msg-root") throw new Error("root mark failed");
    });
    const deps = makeMinimalDeps({ markMessageFailed });

    await handleDeepResearchStartFailure(
      { ...baseParams, activeMessageId: "msg-continuation" },
      deps
    );

    // Both were attempted even though root threw
    expect(markMessageFailed).toHaveBeenCalledWith("msg-root");
    expect(markMessageFailed).toHaveBeenCalledWith("msg-continuation");
  });
});
