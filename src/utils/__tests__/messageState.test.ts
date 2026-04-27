import { describe, expect, test } from "bun:test";
import { buildMessageStateValues } from "../messageState";

describe("buildMessageStateValues", () => {
  test("copies sourceSelectionId into deep-research state values", () => {
    const values = buildMessageStateValues({
      baseValues: {
        conversationId: "conversation-1",
      },
      isDeepResearch: true,
      message: {
        conversation_id: "conversation-1",
        id: "message-1",
        source: "api",
        source_selection_id: "alphafold_db",
        user_id: "user-1",
      },
    });

    expect(values).toMatchObject({
      conversationId: "conversation-1",
      isDeepResearch: true,
      messageId: "message-1",
      source: "api",
      sourceSelectionId: "alphafold_db",
      userId: "user-1",
    });
  });

  test("preserves prior sourceSelectionId for continuation messages without one", () => {
    const values = buildMessageStateValues({
      baseValues: {
        sourceSelectionId: "alphafold_db",
      },
      isDeepResearch: true,
      message: {
        conversation_id: "conversation-1",
        id: "message-2",
        source: "api",
        user_id: "user-1",
      },
    });

    expect(values.sourceSelectionId).toBe("alphafold_db");
    expect(values.messageId).toBe("message-2");
  });
});
