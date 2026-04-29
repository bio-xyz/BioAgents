import { describe, expect, test } from "bun:test";
import { normalizeBranchedMessage } from "../branch";

describe("normalizeBranchedMessage", () => {
  const branchedConversationId = "branch-conv-123";
  const userId = "user-456";

  test("rewrites conversation_id, user_id, and clears state_id", () => {
    const source = {
      content: "answer",
      conversation_id: "source-conv",
      created_at: "2026-04-28T00:00:00Z",
      question: "user question",
      source: "ui",
      state_id: "state-789",
      status: "COMPLETE",
      user_id: "original-user",
    };

    const result = normalizeBranchedMessage(source, branchedConversationId, userId);

    expect(result.conversation_id).toBe(branchedConversationId);
    expect(result.user_id).toBe(userId);
    expect(result.state_id).toBeNull();
  });

  test("preserves COMPLETE status unchanged", () => {
    const source = { content: "ok", question: "q", status: "COMPLETE" };
    const result = normalizeBranchedMessage(source, branchedConversationId, userId);
    expect(result.status).toBe("COMPLETE");
  });

  test("preserves FAILED status unchanged", () => {
    const source = { content: "", question: "q", status: "FAILED" };
    const result = normalizeBranchedMessage(source, branchedConversationId, userId);
    expect(result.status).toBe("FAILED");
  });

  test("normalizes PENDING source row to FAILED in the copy", () => {
    const source = { content: "", question: "user asked something", status: "PENDING" };
    const result = normalizeBranchedMessage(source, branchedConversationId, userId);
    // PENDING in source means: either live in-flight, or a deep-research
    // failure that never wrote FAILED. Either way the copy can't execute
    // (state_id is nulled), so we mark it FAILED in the branch. The user's
    // question is still preserved on the row.
    expect(result.status).toBe("FAILED");
    expect(result.question).toBe("user asked something");
  });

  test("falls back to source='ui' when source field is missing", () => {
    const source = { content: "ok", question: "q", status: "COMPLETE" };
    const result = normalizeBranchedMessage(source, branchedConversationId, userId);
    expect(result.source).toBe("ui");
  });

  test("preserves explicit source field when present", () => {
    const source = { content: "ok", question: "q", source: "api", status: "COMPLETE" };
    const result = normalizeBranchedMessage(source, branchedConversationId, userId);
    expect(result.source).toBe("api");
  });
});
