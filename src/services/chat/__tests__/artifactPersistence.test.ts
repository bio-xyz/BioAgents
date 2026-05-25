import { describe, expect, test } from "bun:test";
import type { ConversationState, ConversationStateValues, DataArtifact } from "../../../types/core";
import { persistNormalChatArtifacts } from "../artifactPersistence";

const artifact: DataArtifact = {
  id: "artifact-1",
  name: "Annotated image",
  path: "artifacts/msg-1/annotated.png",
  type: "image",
};

describe("persistNormalChatArtifacts", () => {
  test("merges against fresh conversation state before writing artifacts", async () => {
    const conversationState: ConversationState = {
      id: "state-1",
      values: { objective: "stale" } as ConversationStateValues,
    };
    let writtenValues: ConversationStateValues | undefined;

    await persistNormalChatArtifacts({
      artifacts: [artifact],
      conversationState,
      getConversationState: async () => ({
        values: {
          normalChatArtifactsByMessageId: {
            "other-msg": [{ id: "artifact-0", name: "Existing", type: "image" }],
          },
          objective: "fresh",
        } as ConversationStateValues,
      }),
      messageId: "msg-1",
      updateConversationState: async (_id, values) => {
        writtenValues = values;
      },
    });

    expect(writtenValues).toBeDefined();
    const values = writtenValues!;
    expect(values.objective).toBe("fresh");
    expect(values.normalChatArtifactsByMessageId?.["other-msg"]).toEqual([
      { id: "artifact-0", name: "Existing", type: "image" },
    ]);
    expect(values.normalChatArtifactsByMessageId?.["msg-1"]).toEqual([artifact]);
    expect(conversationState.values).toBe(values);
  });

  test("throws when the artifact state write fails", async () => {
    await expect(
      persistNormalChatArtifacts({
        artifacts: [artifact],
        conversationState: {
          id: "state-1",
          values: { objective: "fresh" } as ConversationStateValues,
        },
        getConversationState: async () => null,
        messageId: "msg-1",
        updateConversationState: async () => {
          throw new Error("db unavailable");
        },
      })
    ).rejects.toThrow("db unavailable");
  });
});
