import { describe, expect, test } from "bun:test";
import { parseSourceSelectionId, SOURCE_SELECTION_IDS } from "../sourceSelection";

describe("source selection ids", () => {
  test("parses only supported ids", () => {
    for (const sourceSelectionId of SOURCE_SELECTION_IDS) {
      expect(parseSourceSelectionId(sourceSelectionId)).toBe(sourceSelectionId);
    }

    expect(parseSourceSelectionId("pubmed")).toBeUndefined();
    expect(parseSourceSelectionId(null)).toBeUndefined();
  });
});
