import { beforeAll, describe, expect, jest, mock, test } from "bun:test";
import logger from "../../../utils/logger";

// Deterministic unit test for the Postgres 23505 unique-violation arm of
// ensureUserAndConversation. Concurrency alone (see setup.integration.test.ts)
// can't reliably force that branch because HTTP round-trips serialize the
// createUser step ahead of the conversation race. Here we inject the 23505
// failure directly via module mocks, so the branch is exercised on every run.
describe("ensureUserAndConversation — 23505 race arm (unit)", () => {
  let ensureUserAndConversation: typeof import("../setup").ensureUserAndConversation;
  let getConversationCallCount = 0;

  beforeAll(async () => {
    mock.module("../../../db/operations", () => ({
      createConversation: mock(async () => {
        throw Object.assign(new Error("duplicate key value"), { code: "23505" });
      }),
      // Unused on this path but required so dynamic import of setup.ts resolves
      // every named binding it declares at module scope.
      createConversationState: mock(async () => ({})),
      createState: mock(async () => ({})),
      createUser: mock(async () => null),
      // First call (pre-check): pretend the conversation doesn't exist yet.
      // Second call (re-check inside the 23505 arm): someone else now owns it.
      getConversation: mock(async () => {
        getConversationCallCount += 1;
        if (getConversationCallCount === 1) throw new Error("not found");
        return { id: "conv-1", user_id: "someone-else" };
      }),
      getConversationState: mock(async () => ({})),
      updateConversation: mock(async () => undefined),
    }));
    ({ ensureUserAndConversation } = await import("../setup"));
  });

  test("warns conversation_create_race_23505 and returns Access denied; no generic failure log", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    const result = await ensureUserAndConversation("user-1", "conv-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Access denied: conversation belongs to another user");

    const raceWarn = warnSpy.mock.calls.find(([, msg]) => msg === "conversation_create_race_23505");
    expect(raceWarn).toBeDefined();

    const genericFail = errorSpy.mock.calls.find(([, msg]) => msg === "create_conversation_failed");
    expect(genericFail).toBeUndefined();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
