import { describe, expect, test } from "bun:test";
import { runTargetChatTool, TargetChatToolError } from "../chat-tool";

function targetResponse() {
  return {
    alphafold: null,
    cocrystalContacts: [],
    contactChain: "A",
    contactPdbId: "7KI0",
    domains: [],
    gpcrPocketResidues: [],
    gpcrSegments: [],
    homologContacts: [],
    mutagenesisHotspots: [],
    pdbIds: ["7KI0"],
    rankedResidues: [{ position: 144, score: 2.3, sources: ["cocrystal"] }],
    sequence: "MKTAYIA",
    target: {
      geneName: "GLP1R",
      organism: "Homo sapiens",
      proteinName: "Glucagon-like peptide 1 receptor",
      sequenceLength: 463,
      uniprotId: "P43220",
    },
  };
}

describe("runTargetChatTool", () => {
  test("happy path: returns a target-result artifact with correct shape", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(targetResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })) as unknown as typeof fetch;

    try {
      const result = await runTargetChatTool({
        message: "GLP1R",
        messageId: "msg-1",
        toolInput: { query: "GLP1R" },
      });

      expect(result.artifacts).toHaveLength(1);
      const artifact = result.artifacts[0]!;
      expect(artifact.type).toBe("target-result");
      expect(artifact.id).toBe("target-msg-1");
      expect(artifact.name).toBe("Target: GLP1R");
      expect(artifact.metadata).toMatchObject({
        _query: "GLP1R",
        _version: 1,
        target: { uniprotId: "P43220" },
      });
      expect(result.text).toContain("P43220");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("falls back to query as uniprotId text when target field is absent", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ pdbIds: [], rankedResidues: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })) as unknown as typeof fetch;

    try {
      const result = await runTargetChatTool({
        message: "UNKNOWN_GENE",
        messageId: "msg-2",
        toolInput: { query: "UNKNOWN_GENE" },
      });

      expect(result.text).toContain("UNKNOWN_GENE");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("throws TargetChatToolError with statusCode 503 when env vars are absent", async () => {
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    delete process.env.BIO_LIT_AGENT_API_URL;
    delete process.env.BIO_LIT_AGENT_API_KEY;

    try {
      await expect(
        runTargetChatTool({ message: "GLP1R", messageId: "msg-1" })
      ).rejects.toMatchObject({
        message: "Target pipeline service not configured",
        statusCode: 503,
      } satisfies Partial<TargetChatToolError>);
    } finally {
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("throws TargetChatToolError on non-ok upstream response, does not leak body", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response("internal-host.example stacktrace", { status: 500 })) as unknown as typeof fetch;

    try {
      await expect(
        runTargetChatTool({ message: "GLP1R", messageId: "msg-1", toolInput: { query: "GLP1R" } })
      ).rejects.toMatchObject({
        message: "Target pipeline error: 500",
        statusCode: 502,
      } satisfies Partial<TargetChatToolError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("surfaces upstream detail for 4xx (unknown protein)", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ detail: 'Could not resolve "FOOBAR" to a UniProt accession' }),
        {
          headers: { "Content-Type": "application/json" },
          status: 404,
        }
      )) as unknown as typeof fetch;

    try {
      await expect(
        runTargetChatTool({ message: "FOOBAR", messageId: "msg-1", toolInput: { query: "FOOBAR" } })
      ).rejects.toMatchObject({
        message: 'Could not resolve "FOOBAR" to a UniProt accession',
        statusCode: 404,
      } satisfies Partial<TargetChatToolError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("falls back to generic message for 4xx with non-JSON body", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response("<html>404 Not Found</html>", { status: 404 })) as unknown as typeof fetch;

    try {
      await expect(
        runTargetChatTool({ message: "FOOBAR", messageId: "msg-1", toolInput: { query: "FOOBAR" } })
      ).rejects.toMatchObject({
        message: "Target pipeline error: 404",
        statusCode: 404,
      } satisfies Partial<TargetChatToolError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });

  test("throws TargetChatToolError with statusCode 400 for empty query", async () => {
    await expect(
      runTargetChatTool({ message: "", messageId: "msg-1", toolInput: { query: "" } })
    ).rejects.toMatchObject({
      message: "Target tool requires a non-empty query.",
      statusCode: 400,
    } satisfies Partial<TargetChatToolError>);
  });

  test("uses message as query fallback when toolInput is absent", async () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";

    let capturedBody: unknown;
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(targetResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await runTargetChatTool({ message: "GLP1R from message", messageId: "msg-1" });
      expect(capturedBody).toEqual({ query: "GLP1R from message" });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
      else process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      if (originalApiKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
      else process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
    }
  });
});
