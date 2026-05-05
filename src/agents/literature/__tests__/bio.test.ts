import { describe, expect, test } from "bun:test";
import {
  buildBioLiteratureQueryPayload,
  DEFAULT_BIO_LITERATURE_SOURCES,
  resolveBioLiteratureSources,
} from "../bio";

describe("BioLiterature routing", () => {
  test("uses task-level sources when provided", () => {
    const payload = buildBioLiteratureQueryPayload("Find TP53 structures", "deep", [
      "alphafold_db",
    ]);

    expect(payload.sources).toEqual(["alphafold_db"]);
  });

  test("falls back to default BioLiterature sources when task sources are absent", () => {
    expect(resolveBioLiteratureSources()).toEqual([...DEFAULT_BIO_LITERATURE_SOURCES]);
    expect(buildBioLiteratureQueryPayload("Find TP53 literature", "fast").sources).toEqual([
      ...DEFAULT_BIO_LITERATURE_SOURCES,
    ]);
  });
});
