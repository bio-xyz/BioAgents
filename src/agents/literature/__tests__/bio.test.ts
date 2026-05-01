import { afterEach, describe, expect, test } from "bun:test";
import {
  buildBioLiteratureQueryPayload,
  DEFAULT_BIO_LITERATURE_SOURCES,
  resolveBioLiteratureSources,
  searchBioLiterature,
} from "../bio";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.BIO_LIT_AGENT_API_URL;
const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;

describe("searchBioLiterature", () => {
  test("extracts AlphaFold protein structures from tool_results", async () => {
    process.env.BIO_LIT_AGENT_API_URL = "https://literature.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          answer: "AlphaFold DB found one model.",
          tool_results: {
            search_alphafold: {
              results: [
                {
                  id: "AF-Q8W3K0-F1",
                  metadata: {
                    averagePlddt: 82.88,
                    bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
                    entryId: "AF-Q8W3K0-F1",
                    entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
                    gene: "RPP7",
                  },
                  source: "alphafold_db",
                  title: "RPP7",
                  url: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
                },
              ],
            },
          },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await searchBioLiterature("protein sequence", "fast", undefined, [
      "alphafold_db",
    ]);

    expect(result.output).toBe("AlphaFold DB found one model.");
    expect(result.proteinStructures).toEqual([
      {
        averagePlddt: 82.88,
        bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
        entryId: "AF-Q8W3K0-F1",
        entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
        gene: "RPP7",
        title: "RPP7",
      },
    ]);
  });
});

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.BIO_LIT_AGENT_API_URL;
  } else {
    process.env.BIO_LIT_AGENT_API_URL = originalApiUrl;
  }
  if (originalApiKey === undefined) {
    delete process.env.BIO_LIT_AGENT_API_KEY;
  } else {
    process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
  }
});
