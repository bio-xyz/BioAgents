import { afterEach, describe, expect, test } from "bun:test";
import { executeTool } from "../registry";
import "../tools/literature-search";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.BIO_LIT_AGENT_API_URL;
const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

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

describe("literature_search", () => {
  test("returns protein structures from BioLiterature stream results", async () => {
    process.env.BIO_LIT_AGENT_API_URL = "https://literature.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";

    globalThis.fetch = (async () =>
      new Response(
        makeStream(
          'event: final\ndata: {"runId":"run-1","sequence":1,"response":{"answer":"final answer","tool_results":{"search_alphafold":{"results":[{"id":"AF-Q8W3K0-F1","title":"RPP7","url":"https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1","source":"alphafold_db","metadata":{"entryId":"AF-Q8W3K0-F1","entryUrl":"https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1","bcifUrl":"https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif","averagePlddt":82.88}}]}}}}\n\n'
        ),
        { status: 200 }
      )) as unknown as typeof fetch;

    const result = await executeTool("literature_search", {
      query: "show this AlphaFold model",
      source: "biolit",
    });

    expect(result.content).toBe("final answer");
    expect(result.proteinStructures?.[0]).toEqual({
      averagePlddt: 82.88,
      bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-Q8W3K0-F1-model_v6.bcif",
      entryId: "AF-Q8W3K0-F1",
      entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-Q8W3K0-F1",
      title: "RPP7",
    });
  });
});
