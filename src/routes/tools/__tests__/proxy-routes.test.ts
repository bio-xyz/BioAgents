/**
 * Proxy route unit tests.
 *
 * Auth is bypassed via AUTH_MODE=none (authResolver creates anonymous user).
 * The tools-bucket 429 path is covered by the "rateLimitMiddleware 429 branch" suite below,
 * which uses mock.module to inject a fake Redis that reports the bucket exhausted.
 * The BullMQ worker UnrecoverableError branch (chat.worker.ts:runTargetForJob) is a
 * documented skip — see the "chat.worker runTargetForJob" suite at the bottom.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFetch(status: number, body: unknown, contentType = "application/json") {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      headers: { "Content-Type": contentType },
      status,
    })) as unknown as typeof fetch;
}

async function jsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return await res.text();
  }
}

// ── AlphaFold proxy — SSRF validation ────────────────────────────────────────

describe("alphafoldProxy SSRF validation", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAuthMode: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "none";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  test("rejects request with no url param", async () => {
    const { alphafoldProxyRoute } = await import("../alphafoldProxy");
    const res = await alphafoldProxyRoute.handle(
      new Request("http://localhost/api/tools/alphafold/proxy")
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });

  test("rejects non-HTTPS URL (http://)", async () => {
    const { alphafoldProxyRoute } = await import("../alphafoldProxy");
    const url = encodeURIComponent("http://alphafold.ebi.ac.uk/files/AF-P43220-F1-model_v4.pdb");
    const res = await alphafoldProxyRoute.handle(
      new Request(`http://localhost/api/tools/alphafold/proxy?url=${url}`)
    );
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
  });

  test("rejects URL pointing to non-AlphaFold host", async () => {
    const { alphafoldProxyRoute } = await import("../alphafoldProxy");
    const url = encodeURIComponent("https://evil.example.com/steal-data");
    const res = await alphafoldProxyRoute.handle(
      new Request(`http://localhost/api/tools/alphafold/proxy?url=${url}`)
    );
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
  });

  test("rejects @-bypass SSRF trick (user:pass@host URL)", async () => {
    // Attacker encodes credentials to point alphafold.ebi.ac.uk as user and evil.com as host.
    const { alphafoldProxyRoute } = await import("../alphafoldProxy");
    const url = encodeURIComponent("https://alphafold.ebi.ac.uk@evil.example.com/file.pdb");
    const res = await alphafoldProxyRoute.handle(
      new Request(`http://localhost/api/tools/alphafold/proxy?url=${url}`)
    );
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body.error).toBeTruthy();
  });

  test("proxies a valid AlphaFold EBI URL", async () => {
    const { alphafoldProxyRoute } = await import("../alphafoldProxy");
    globalThis.fetch = makeFetch(
      200,
      "ATOM    1  N   ALA A   1       0.000   0.000   0.000",
      "text/plain"
    );
    const url = encodeURIComponent("https://alphafold.ebi.ac.uk/files/AF-P43220-F1-model_v4.pdb");
    const res = await alphafoldProxyRoute.handle(
      new Request(`http://localhost/api/tools/alphafold/proxy?url=${url}`)
    );
    expect(res.status).toBe(200);
  });
});

// ── pdbProxy ─────────────────────────────────────────────────────────────────

describe("pdbProxy validation", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAuthMode: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "none";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  test("rejects missing pdbId", async () => {
    const { pdbProxyRoute } = await import("../pdbProxy");
    const res = await pdbProxyRoute.handle(new Request("http://localhost/api/tools/pdb-proxy"));
    expect(res.status).toBe(400);
  });

  test("rejects pdbId with wrong format", async () => {
    const { pdbProxyRoute } = await import("../pdbProxy");
    const res = await pdbProxyRoute.handle(
      new Request("http://localhost/api/tools/pdb-proxy?pdbId=../../etc/passwd")
    );
    expect(res.status).toBe(400);
  });

  test("returns 404 when RCSB does not have the structure", async () => {
    const { pdbProxyRoute } = await import("../pdbProxy");
    globalThis.fetch = makeFetch(404, "Not Found", "text/plain");
    const res = await pdbProxyRoute.handle(
      new Request("http://localhost/api/tools/pdb-proxy?pdbId=ZZZZ")
    );
    expect(res.status).toBe(404);
  });

  test("converts non-404 RCSB errors to 502", async () => {
    const { pdbProxyRoute } = await import("../pdbProxy");
    globalThis.fetch = makeFetch(500, "Internal Server Error", "text/plain");
    const res = await pdbProxyRoute.handle(
      new Request("http://localhost/api/tools/pdb-proxy?pdbId=7KI0")
    );
    expect(res.status).toBe(502);
  });
});

// ── target proxy ─────────────────────────────────────────────────────────────

describe("target proxy", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAuthMode: string | undefined;
  let originalBioLitUrl: string | undefined;
  let originalBioLitKey: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAuthMode = process.env.AUTH_MODE;
    originalBioLitUrl = process.env.BIO_LIT_AGENT_API_URL;
    originalBioLitKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.AUTH_MODE = "none";
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalBioLitUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
    else process.env.BIO_LIT_AGENT_API_URL = originalBioLitUrl;
    if (originalBioLitKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
    else process.env.BIO_LIT_AGENT_API_KEY = originalBioLitKey;
  });

  test("returns 503 when env vars are absent", async () => {
    delete process.env.BIO_LIT_AGENT_API_URL;
    delete process.env.BIO_LIT_AGENT_API_KEY;
    const { targetRoute } = await import("../target");
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "GLP1R" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(503);
  });

  test("returns 422 when body is missing query field", async () => {
    const { targetRoute } = await import("../target");
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when query is empty string", async () => {
    const { targetRoute } = await import("../target");
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(422);
  });

  test("forwards 404 from upstream (gene not found)", async () => {
    const { targetRoute } = await import("../target");
    globalThis.fetch = makeFetch(404, { detail: "UniProt resolution failed for 'FAKEGENE'" });
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "FAKEGENE" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    // 4xx body is forwarded for user-facing error context
    expect(body).toBeDefined();
  });

  test("converts upstream 5xx to 502 without leaking body", async () => {
    const { targetRoute } = await import("../target");
    globalThis.fetch = makeFetch(500, "internal-host.bio stacktrace line 42", "text/plain");
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "GLP1R" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(502);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    // Must not leak the internal stacktrace
    expect(JSON.stringify(body)).not.toContain("internal-host.bio");
    expect(JSON.stringify(body)).not.toContain("stacktrace");
  });

  test("returns 502 when upstream 2xx response is non-JSON", async () => {
    const { targetRoute } = await import("../target");
    globalThis.fetch = makeFetch(200, "<html>Bad gateway</html>", "text/html");
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "GLP1R" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(502);
  });

  test("proxies successful upstream response", async () => {
    const { targetRoute } = await import("../target");
    const upstream = { rankedResidues: [], target: { uniprotId: "P43220" } };
    globalThis.fetch = makeFetch(200, upstream);
    const res = await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "GLP1R" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect((body as { target?: { uniprotId?: string } }).target?.uniprotId).toBe("P43220");
  });

  test("strips trailing slash from BIO_LIT_AGENT_API_URL", async () => {
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test/";
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ rankedResidues: [], target: { uniprotId: "P43220" } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;
    const { targetRoute } = await import("../target");
    await targetRoute.handle(
      new Request("http://localhost/api/tools/target", {
        body: JSON.stringify({ query: "GLP1R" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(capturedUrl).not.toContain("//tools");
    expect(capturedUrl).toBe("https://bio-lit.test/tools/target");
  });
});

// ── p2rank proxy ──────────────────────────────────────────────────────────────

describe("p2rank proxy", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAuthMode: string | undefined;
  let originalBioLitUrl: string | undefined;
  let originalBioLitKey: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAuthMode = process.env.AUTH_MODE;
    originalBioLitUrl = process.env.BIO_LIT_AGENT_API_URL;
    originalBioLitKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.AUTH_MODE = "none";
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalBioLitUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
    else process.env.BIO_LIT_AGENT_API_URL = originalBioLitUrl;
    if (originalBioLitKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
    else process.env.BIO_LIT_AGENT_API_KEY = originalBioLitKey;
  });

  test("returns 503 when env vars are absent", async () => {
    delete process.env.BIO_LIT_AGENT_API_URL;
    delete process.env.BIO_LIT_AGENT_API_KEY;
    const { p2rankRoute } = await import("../p2rank");
    const res = await p2rankRoute.handle(
      new Request("http://localhost/api/tools/target/p2rank", {
        body: JSON.stringify({ pdb_id: "7KI0" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(503);
  });

  test("returns 422 when pdb_id is wrong length", async () => {
    const { p2rankRoute } = await import("../p2rank");
    const res = await p2rankRoute.handle(
      new Request("http://localhost/api/tools/target/p2rank", {
        body: JSON.stringify({ pdb_id: "TOO_LONG_ID" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(422);
  });

  test("converts upstream 5xx to 502 without leaking body", async () => {
    const { p2rankRoute } = await import("../p2rank");
    globalThis.fetch = makeFetch(500, "modal internal error: OOM on function", "text/plain");
    const res = await p2rankRoute.handle(
      new Request("http://localhost/api/tools/target/p2rank", {
        body: JSON.stringify({ pdb_id: "7KI0" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(502);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("modal internal error");
    expect(JSON.stringify(body)).not.toContain("OOM");
  });

  test("strips trailing slash from BIO_LIT_AGENT_API_URL", async () => {
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test/";
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ pockets: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;
    const { p2rankRoute } = await import("../p2rank");
    await p2rankRoute.handle(
      new Request("http://localhost/api/tools/target/p2rank", {
        body: JSON.stringify({ pdb_id: "7KI0" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(capturedUrl).not.toContain("//tools");
    expect(capturedUrl).toBe("https://bio-lit.test/tools/target/p2rank");
  });
});

// ── contacts proxy ────────────────────────────────────────────────────────────

describe("contacts proxy", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalAuthMode: string | undefined;
  let originalBioLitUrl: string | undefined;
  let originalBioLitKey: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAuthMode = process.env.AUTH_MODE;
    originalBioLitUrl = process.env.BIO_LIT_AGENT_API_URL;
    originalBioLitKey = process.env.BIO_LIT_AGENT_API_KEY;
    process.env.AUTH_MODE = "none";
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test";
    process.env.BIO_LIT_AGENT_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalBioLitUrl === undefined) delete process.env.BIO_LIT_AGENT_API_URL;
    else process.env.BIO_LIT_AGENT_API_URL = originalBioLitUrl;
    if (originalBioLitKey === undefined) delete process.env.BIO_LIT_AGENT_API_KEY;
    else process.env.BIO_LIT_AGENT_API_KEY = originalBioLitKey;
  });

  test("returns 503 when env vars are absent", async () => {
    delete process.env.BIO_LIT_AGENT_API_URL;
    delete process.env.BIO_LIT_AGENT_API_KEY;
    const { contactsRoute } = await import("../contacts");
    const res = await contactsRoute.handle(
      new Request("http://localhost/api/tools/target/contacts?pdb_id=7KI0")
    );
    expect(res.status).toBe(503);
  });

  test("returns 422 when pdb_id fails pattern validation", async () => {
    const { contactsRoute } = await import("../contacts");
    const res = await contactsRoute.handle(
      new Request("http://localhost/api/tools/target/contacts?pdb_id=!BAD")
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when pdb_id is wrong length", async () => {
    const { contactsRoute } = await import("../contacts");
    const res = await contactsRoute.handle(
      new Request("http://localhost/api/tools/target/contacts?pdb_id=AB")
    );
    expect(res.status).toBe(422);
  });

  test("proxies successful upstream response", async () => {
    const { contactsRoute } = await import("../contacts");
    const upstream = { chain: "R", contacts: [] };
    globalThis.fetch = makeFetch(200, upstream);
    const res = await contactsRoute.handle(
      new Request("http://localhost/api/tools/target/contacts?pdb_id=7KI0")
    );
    expect(res.status).toBe(200);
  });

  test("strips trailing slash from BIO_LIT_AGENT_API_URL", async () => {
    process.env.BIO_LIT_AGENT_API_URL = "https://bio-lit.test/";
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ contacts: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;
    const { contactsRoute } = await import("../contacts");
    await contactsRoute.handle(
      new Request("http://localhost/api/tools/target/contacts?pdb_id=7KI0")
    );
    // URL is built via `new URL(...)` so we check the origin only — no double slash.
    expect(capturedUrl).not.toContain("//tools");
    expect(capturedUrl).toContain("https://bio-lit.test/tools/target/contacts");
  });
});

// ── rate-limit middleware — 429 branch ───────────────────────────────────────
// `isJobQueueEnabled()` reads process.env.USE_JOB_QUEUE at call time, so we can
// enable it per-test without import-time binding issues. `getBullMQConnection` is
// called via a dynamic import inside checkRateLimit, so mock.module intercepts it
// cleanly even though rateLimiter.ts is already loaded.

describe("rateLimitMiddleware 429 branch", () => {
  let originalJobQueue: string | undefined;

  beforeEach(() => {
    originalJobQueue = process.env.USE_JOB_QUEUE;
  });

  afterEach(() => {
    if (originalJobQueue === undefined) delete process.env.USE_JOB_QUEUE;
    else process.env.USE_JOB_QUEUE = originalJobQueue;
    mock.restore();
  });

  test("middleware returns 429 when the tools bucket is exhausted", async () => {
    // Simulate tools bucket at capacity: currentCount=30, max=30.
    // fakeRedis is a Proxy that catches every method call so that other modules
    // loading the mocked connection during parallel test execution (e.g. artifactPersistence)
    // don't crash. Unknown methods return null; set() returns "OK" (lock acquired).
    const execResult: Array<[null, unknown]> = [
      [null, null], // zremrangebyscore
      [null, 30], // zcard — value checkRateLimit reads as currentCount
      [null, null], // zadd
      [null, null], // expire
    ];
    const fakeMulti = new Proxy(
      { exec: async () => execResult },
      {
        get(t, k: string) {
          return k in t ? t[k as keyof typeof t] : () => fakeMulti;
        },
      }
    );
    const fakeRedis = new Proxy(
      {
        del: async () => 1, // artifactPersistence lock release
        multi: () => fakeMulti,
        set: async () => "OK", // artifactPersistence lock acquisition
        zrange: async () => [String(Math.floor(Date.now() / 1000) - 30), "60"],
        zremrangebyscore: async () => 0,
      },
      {
        get(t, k: string) {
          return k in t ? t[k as keyof typeof t] : async () => null;
        },
      }
    );

    mock.module("../../../services/queue/connection", () => ({
      getBullMQConnection: () => fakeRedis,
      isJobQueueEnabled: () => true,
    }));

    process.env.USE_JOB_QUEUE = "true";

    const { rateLimitMiddleware } = await import("../../../middleware/rateLimiter");
    const middleware = rateLimitMiddleware("tools");

    const set: { status?: number | string; headers: Record<string, string | number> } = {
      headers: {},
    };
    const req = Object.assign(new Request("http://localhost/"), {
      auth: { userId: "user-over-limit" },
    });

    const result = await middleware({
      request: req as Parameters<typeof middleware>[0]["request"],
      set,
    });

    expect(set.status).toBe(429);
    expect((result as Record<string, unknown>)?.error).toBe("Rate limit exceeded");
  });
});

// ── known gap: BullMQ worker UnrecoverableError path ─────────────────────────
// The branch in chat.worker.ts:runTargetForJob that converts TargetChatToolError
// 4xx/503 into UnrecoverableError is NOT exercised by these unit tests. Testing
// it would require mocking BullMQ Job, markMessageComplete, persistNormalChatArtifacts,
// and all notify functions — substantial scaffolding for a thin orchestration wrapper.
// This path is covered by manual integration testing with USE_JOB_QUEUE=true.

describe("chat.worker runTargetForJob — documented gap", () => {
  test.skip("UnrecoverableError on TargetChatToolError 4xx/503 — integration only", () => {
    // See comment above. Not a unit-testable path without heavy BullMQ mocks.
  });
});
