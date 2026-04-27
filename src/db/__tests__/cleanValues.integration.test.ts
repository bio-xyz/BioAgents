import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import type { StateValues } from "../../types/core";
import { describeIfSupabase } from "../../utils/__testHelpers__/integrationEnv";

describeIfSupabase("[integration] cleanValues strips legacy rawFiles", () => {
  // Dynamic imports — operations.ts instantiates the Supabase client at module
  // load time; loading it without env throws.
  let createState: typeof import("../../db/operations").createState;
  let getState: typeof import("../../db/operations").getState;
  let updateState: typeof import("../../db/operations").updateState;
  let getServiceClient: typeof import("../../db/client").getServiceClient;

  beforeAll(async () => {
    ({ createState, getState, updateState } = await import("../../db/operations"));
    ({ getServiceClient } = await import("../../db/client"));
  });

  let stateId: string = "";

  beforeEach(async () => {
    // Seed a row. createState does NOT run cleanValues, so it accepts the
    // legacy-shape rawFiles (not in the declared type) verbatim.
    const seed = {
      values: {
        rawFiles: [
          {
            buffer: "base64-binary-stand-in-" + "A".repeat(2048),
            filename: "legacy.pdf",
            metadata: { pages: 3 },
            mimeType: "application/pdf",
            parsedText: "a".repeat(10_000),
          },
        ],
      } as unknown as StateValues,
    };
    const row = await createState(seed);
    stateId = row.id!;

    // Verify the seed landed with the heavy fields intact — otherwise the
    // post-update assertions would pass vacuously if the JSONB column (or a
    // future schema change) silently coerced them away at insert time.
    const seeded = await getState(stateId);
    const seededRf = (seeded!.values as { rawFiles?: Array<Record<string, unknown>> }).rawFiles;
    expect(seededRf?.[0]?.buffer).toBeDefined();
    expect(seededRf?.[0]?.parsedText).toBeDefined();
  });

  afterEach(async () => {
    if (!stateId) return;
    const supabase = getServiceClient();
    const { error } = await supabase.from("states").delete().eq("id", stateId);
    if (error) throw new Error(`states cleanup failed: ${error.message}`);
    stateId = "";
  });

  test("updateState with rawFiles payload persists without buffer/parsedText", async () => {
    // Invariant: cleanValues must strip `buffer` and `parsedText` from every
    // rawFiles entry before persistence, so state rows don't balloon past
    // Postgres' JSONB row limits as files accumulate in a conversation.
    const rawFilesPayload = {
      rawFiles: [
        {
          buffer: "base64-binary-stand-in-" + "B".repeat(2048),
          filename: "legacy.pdf",
          metadata: { pages: 3 },
          mimeType: "application/pdf",
          parsedText: "b".repeat(10_000),
        },
      ],
    } as unknown as Partial<StateValues>;

    await updateState(stateId, rawFilesPayload);

    const row = await getState(stateId);
    expect(row).toBeDefined();

    const persisted = row!.values as Record<string, unknown>;
    const rf = persisted.rawFiles as Array<Record<string, unknown>> | undefined;
    expect(rf).toBeDefined();
    expect(rf!).toHaveLength(1);

    const entry = rf![0]!;
    expect(entry.buffer).toBeUndefined();
    expect(entry.parsedText).toBeUndefined();
    expect(entry.filename).toBe("legacy.pdf");
    expect(entry.mimeType).toBe("application/pdf");
    expect(entry.metadata).toEqual({ pages: 3 });
  });
});
