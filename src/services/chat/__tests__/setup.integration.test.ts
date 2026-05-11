import { afterEach, beforeAll, beforeEach, expect, jest, test } from "bun:test";
import { describeIfSupabase } from "../../../utils/__testHelpers__/integrationEnv";
import { generateUUID } from "../../../utils/uuid";

describeIfSupabase("[integration] ensureUserAndConversation — concurrent 23505 race", () => {
  // Dynamic imports so the module graph isn't loaded when env is absent —
  // src/db/operations.ts eagerly calls getServiceClient() on module eval.
  let ensureUserAndConversation: typeof import("../setup").ensureUserAndConversation;
  let getServiceClient: typeof import("../../../db/client").getServiceClient;
  let logger: typeof import("../../../utils/logger")["default"];

  beforeAll(async () => {
    ({ ensureUserAndConversation } = await import("../setup"));
    ({ getServiceClient } = await import("../../../db/client"));
    logger = (await import("../../../utils/logger")).default;
  });

  const CONCURRENCY = 10;
  let conversationId: string;
  let userIds: string[];

  beforeEach(() => {
    conversationId = generateUUID();
    userIds = Array.from({ length: CONCURRENCY }, () => generateUUID());
  });

  afterEach(async () => {
    const supabase = getServiceClient();
    // Delete in FK order: conversations -> users. Surface PostgREST errors
    // so a silent cleanup failure doesn't leak rows into later test runs.
    if (conversationId) {
      const { error: convErr } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId);
      if (convErr) throw new Error(`conversations cleanup failed: ${convErr.message}`);
    }
    if (userIds.length > 0) {
      const { error: userErr } = await supabase.from("users").delete().in("id", userIds);
      if (userErr) throw new Error(`users cleanup failed: ${userErr.message}`);
    }
    jest.restoreAllMocks();
  });

  test("exactly one winner under concurrency; no generic failure logged", async () => {
    // End-to-end concurrency lock: with N callers racing against the same
    // conversationId, the DB ends up with exactly one owning user, the losers
    // all get the standard "Access denied" string, and setup.ts never takes
    // the generic create_conversation_failed arm. The 23505 branch itself is
    // not reliably reachable from here (HTTP round-trips serialize the
    // createUser step so the winner typically commits before other callers
    // reach getConversation) — that branch is pinned deterministically by
    // setup.race.test.ts using module mocks.
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    const results = await Promise.all(
      userIds.map((uid) => ensureUserAndConversation(uid, conversationId))
    );

    const winners = results.filter((r) => r.success);
    const losers = results.filter((r) => !r.success);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(CONCURRENCY - 1);
    for (const loser of losers) {
      expect(loser.error).toBe("Access denied: conversation belongs to another user");
    }

    // Whichever path each loser took (pre-check or 23505), none should have
    // landed in the generic failure arm — a resurgence of the `{...err}`
    // spread regression would log this for any caller that raced to INSERT.
    const genericFailureCall = errorSpy.mock.calls.find(
      ([, msg]) => msg === "create_conversation_failed"
    );
    expect(genericFailureCall).toBeUndefined();

    // The DB row should exist and belong to the sole winner.
    const supabase = getServiceClient();
    const { data } = await supabase
      .from("conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .single();
    expect(data).toBeDefined();
    const winningUserId = userIds[results.findIndex((r) => r.success)];
    expect(data!.user_id).toBe(winningUserId);
  });
});
