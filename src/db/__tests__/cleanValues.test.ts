import { describe, expect, test } from "bun:test";
import type { ConversationStateValues, PlanTask } from "../../types/core";
import { cleanValues } from "../cleanValues";

describe("cleanValues", () => {
  test("strips buffer from uploadedDatasets while preserving content", () => {
    const input: Partial<ConversationStateValues> = {
      uploadedDatasets: [
        {
          // @ts-expect-error legacy field not in the declared type
          buffer: Buffer.from("AAAA"),
          content: "row1,row2",
          description: "x",
          filename: "f.csv",
          id: "d1",
          size: 10,
        },
      ],
    };
    const out = cleanValues(input);
    expect(out.uploadedDatasets).toHaveLength(1);
    const d = out.uploadedDatasets?.[0] as Record<string, unknown>;
    expect(d.buffer).toBeUndefined();
    expect(d.content).toBe("row1,row2");
    expect(d.filename).toBe("f.csv");
  });

  test("strips content from plan task datasets but keeps metadata", () => {
    const input: Partial<ConversationStateValues> = {
      plan: [
        {
          datasets: [
            {
              // @ts-expect-error content is stripped
              content: "heavy",
              description: "x",
              filename: "a.csv",
              id: "a",
            },
          ],
          objective: "test",
          type: "LITERATURE",
        } as PlanTask,
      ],
    };
    const out = cleanValues(input);
    const ds = out.plan?.[0]?.datasets?.[0] as Record<string, unknown>;
    expect(ds.content).toBeUndefined();
    expect(ds.filename).toBe("a.csv");
  });

  test("strips content from plan task artifacts", () => {
    const input: Partial<ConversationStateValues> = {
      plan: [
        {
          artifacts: [
            {
              content: "<binary>",
              description: "fig",
              id: "art-1",
              name: "fig.png",
              type: "FILE",
            },
          ],
          datasets: [],
          objective: "o",
          type: "ANALYSIS",
        } as PlanTask,
      ],
    };
    const out = cleanValues(input);
    const art = out.plan?.[0]?.artifacts?.[0] as Record<string, unknown>;
    expect(art.content).toBeUndefined();
    expect(art.id).toBe("art-1");
    expect(art.type).toBe("FILE");
  });

  test("strips buffer and parsedText from legacy rawFiles", () => {
    // rawFiles is not part of ConversationStateValues; pre-2025-11-26 state
    // docs carried it. The strip guards against re-persisting those fields.
    const input = {
      rawFiles: [
        {
          buffer: Buffer.from("AAAA"),
          filename: "legacy.pdf",
          metadata: { pages: 3 },
          mimeType: "application/pdf",
          parsedText: "a".repeat(10_000),
          size: 4,
        },
      ],
    } as unknown as Partial<ConversationStateValues>;
    const out = cleanValues(input) as Record<string, unknown>;
    const rf = out.rawFiles as Array<Record<string, unknown>>;
    expect(rf).toHaveLength(1);
    const entry = rf[0]!;
    expect(entry.buffer).toBeUndefined();
    expect(entry.parsedText).toBeUndefined();
    expect(entry.filename).toBe("legacy.pdf");
    expect(entry.mimeType).toBe("application/pdf");
    expect(entry.metadata).toEqual({ pages: 3 });
  });

  test("does not mutate the input object", () => {
    const original = {
      uploadedDatasets: [{ buffer: "keep-me", description: "x", filename: "f.csv", id: "d1" }],
    } as unknown as Partial<ConversationStateValues>;
    const snapshot = JSON.parse(JSON.stringify(original));
    cleanValues(original);
    expect(original).toEqual(snapshot);
  });

  test("handles empty / undefined arrays gracefully", () => {
    expect(cleanValues({})).toEqual({});
    expect(cleanValues({ uploadedDatasets: [] })).toEqual({ uploadedDatasets: [] });
    expect(cleanValues({ plan: [] })).toEqual({ plan: [] });
  });

  test("handles plan entries without datasets or artifacts", () => {
    const input: Partial<ConversationStateValues> = {
      plan: [{ datasets: [], objective: "o", type: "LITERATURE" } as PlanTask],
    };
    const out = cleanValues(input);
    expect(out.plan).toHaveLength(1);
    expect(out.plan?.[0]?.objective).toBe("o");
  });

  test("leaves non-object rawFiles entries untouched", () => {
    const input = {
      rawFiles: ["not-an-object", null, { buffer: "x" }],
    } as unknown as Partial<ConversationStateValues>;
    const out = cleanValues(input) as Record<string, unknown>;
    const rf = out.rawFiles as unknown[];
    expect(rf[0]).toBe("not-an-object");
    expect(rf[1]).toBeNull();
    expect((rf[2] as Record<string, unknown>).buffer).toBeUndefined();
  });
});
