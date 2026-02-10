/**
 * x402 Individual Agent Integration Tests
 *
 * Tests all 7 x402 agent endpoints with REAL testnet payments on Base Sepolia.
 * Stores full inputs/outputs in test-results.json for review.
 *
 * Required env:
 *   X402_TEST_PRIVATE_KEY  — test wallet private key with Base Sepolia USDC
 *
 * Usage:
 *   bun run scripts/x402/test-x402-agents.ts
 *
 * Total cost: ~$0.10 USDC (testnet) per run
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { spawn, type Subprocess } from "bun";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Configuration ──────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.X402_TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ X402_TEST_PRIVATE_KEY not set in environment");
  process.exit(1);
}

const SERVER_PORT = Number(process.env.PORT) || 8080;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
// Register both CAIP-2 and common name formats to match whatever the server uses
const NETWORK = process.env.X402_NETWORK || "eip155:84532";
const NETWORK_CAIP2 = "eip155:84532"; // Base Sepolia CAIP-2 standard
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 180_000; // 3 min per agent (LLM + external services can be slow)
const ANALYSIS_TIMEOUT_MS = 300_000; // 5 min for analysis agent (calls external service)

// ── Test Payloads ──────────────────────────────────────────────────────────

// Small CSV for analysis agent
const SAMPLE_CSV = [
  "gene,expression_level,sample_type",
  "TP53,8.2,tumor",
  "BRCA1,3.1,tumor",
  "MYC,12.5,tumor",
  "TP53,4.1,normal",
  "BRCA1,5.8,normal",
].join("\n");

const SAMPLE_CSV_BASE64 = Buffer.from(SAMPLE_CSV).toString("base64");

interface AgentTest {
  agent: string;
  endpoint: string;
  price: string;
  input: Record<string, unknown>;
}

const AGENT_TESTS: AgentTest[] = [
  {
    agent: "literature",
    endpoint: "/api/x402/agents/literature",
    price: "$0.01",
    input: {
      objective:
        "CRISPR-Cas9 gene editing mechanisms in cancer therapy",
      type: "OPENSCHOLAR",
    },
  },
  {
    agent: "reply",
    endpoint: "/api/x402/agents/reply",
    price: "$0.01",
    input: {
      message: "Explain the role of p53 in cancer suppression",
      context: [],
    },
  },
  {
    agent: "planning",
    endpoint: "/api/x402/agents/planning",
    price: "$0.01",
    input: {
      objective:
        "Investigate the therapeutic potential of mRNA vaccines for solid tumors",
    },
  },
  {
    agent: "hypothesis",
    endpoint: "/api/x402/agents/hypothesis",
    price: "$0.02",
    input: {
      objective: "mRNA vaccine efficacy in solid tumors",
      completedTasks: [
        {
          id: "lit-1",
          type: "LITERATURE",
          objective: "mRNA vaccine tumor targeting",
          output:
            "Recent studies show mRNA vaccines can encode tumor-specific antigens, eliciting CD8+ T-cell responses. Phase I trials demonstrate safety and partial response in melanoma patients.",
        },
      ],
    },
  },
  {
    agent: "reflection",
    endpoint: "/api/x402/agents/reflection",
    price: "$0.015",
    input: {
      objective: "mRNA vaccines for solid tumors",
      hypothesis:
        "mRNA vaccines encoding personalized neoantigens may improve T-cell response in solid tumors",
      completedTasks: [
        {
          type: "LITERATURE",
          objective: "mRNA tumor vaccines clinical outcomes",
          output:
            "Phase II trials show 30% overall response rate in NSCLC patients treated with personalized mRNA neoantigen vaccines. Combination with anti-PD1 improved response to 48%.",
        },
      ],
    },
  },
  {
    agent: "discovery",
    endpoint: "/api/x402/agents/discovery",
    price: "$0.02",
    input: {
      completedTasks: [
        {
          id: "lit-1",
          type: "LITERATURE",
          objective: "mRNA vaccine delivery mechanisms",
          output:
            "Key finding: lipid nanoparticle (LNP) delivery improves antigen presentation by 4x compared to naked mRNA. ionizable lipids with pKa 6.2-6.5 show optimal endosomal escape. Combination of DOTAP and cholesterol in 50:38.5 molar ratio yields highest transfection efficiency in dendritic cells.",
        },
      ],
      hypothesis:
        "LNP-encapsulated mRNA vaccines show superior immune activation due to enhanced dendritic cell uptake and antigen presentation",
    },
  },
  {
    agent: "analysis",
    endpoint: "/api/x402/agents/analysis",
    price: "$0.025",
    input: {
      objective:
        "Analyze gene expression patterns in tumor vs normal samples to identify differentially expressed genes",
      datasets: [
        {
          filename: "test_gene_expression.csv",
          id: "test-dataset-1",
          description:
            "Gene expression levels for TP53, BRCA1, and MYC in tumor and normal tissue samples",
          content: SAMPLE_CSV_BASE64,
        },
      ],
      type: "BIO",
    },
  },
];

// ── Server Management ──────────────────────────────────────────────────────

let serverProcess: Subprocess | null = null;

async function startServer(): Promise<void> {
  console.log("🚀 Starting server...");

  const projectRoot = join(import.meta.dir, "../..");

  // Resolve bun binary — may not be in default PATH
  const bunBin =
    typeof Bun !== "undefined" && Bun.which("bun")
      ? Bun.which("bun")!
      : join(
          process.env.HOME || process.env.USERPROFILE || "~",
          ".bun",
          "bin",
          "bun",
        );

  // Filter out empty-string env vars so Bun's built-in .env loading can
  // provide the correct values (shell env with empty values takes precedence
  // over .env file values, causing "API_KEY is not configured" errors)
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== "") {
      cleanEnv[key] = value;
    }
  }

  serverProcess = spawn({
    cmd: [bunBin, "src/index.ts"],
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv,
  });

  // Wait for health check
  const startTime = Date.now();
  while (Date.now() - startTime < HEALTH_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        console.log(`✅ Server ready (took ${Date.now() - startTime}ms)\n`);
        return;
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Server failed to start within ${HEALTH_TIMEOUT_MS / 1000}s`,
  );
}

function stopServer(): void {
  if (serverProcess) {
    console.log("\n🛑 Stopping server...");
    serverProcess.kill();
    serverProcess = null;
  }
}

// ── Payment Client Setup ───────────────────────────────────────────────────

function createPaymentFetch() {
  // Ensure private key has 0x prefix (viem requires it)
  const pk = PRIVATE_KEY!.startsWith("0x") ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`;
  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`💳 Wallet: ${account.address}`);
  console.log(`🌐 Network: ${NETWORK}\n`);

  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: account,
    networks: [NETWORK_CAIP2],
  });

  return {
    x402Fetch: wrapFetchWithPayment(fetch, client),
    walletAddress: account.address,
  };
}

// ── Test Runner ────────────────────────────────────────────────────────────

interface TestResult {
  agent: string;
  endpoint: string;
  price: string;
  input: Record<string, unknown>;
  response: {
    status: number;
    body: unknown;
    paymentHeader: unknown | null;
  } | null;
  durationMs: number;
  success: boolean;
  error: string | null;
}

async function runAgentTest(
  test: AgentTest,
  x402Fetch: typeof fetch,
): Promise<TestResult> {
  const startTime = Date.now();
  const url = `${BASE_URL}${test.endpoint}`;

  try {
    const controller = new AbortController();
    const agentTimeout = test.agent === "analysis" ? ANALYSIS_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const timeout = setTimeout(
      () => controller.abort(),
      agentTimeout,
    );

    const response = await x402Fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(test.input),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const durationMs = Date.now() - startTime;

    // Parse response body
    let body: unknown;
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 2000) };
    }

    // Decode payment response header
    let paymentHeader: unknown = null;
    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponseHeader) {
      try {
        paymentHeader = JSON.parse(atob(paymentResponseHeader));
      } catch {
        paymentHeader = { raw: paymentResponseHeader.slice(0, 200) };
      }
    }

    const success = response.status >= 200 && response.status < 300;

    return {
      agent: test.agent,
      endpoint: test.endpoint,
      price: test.price,
      input: test.input,
      response: {
        status: response.status,
        body,
        paymentHeader,
      },
      durationMs,
      success,
      error: success ? null : `HTTP ${response.status}`,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    return {
      agent: test.agent,
      endpoint: test.endpoint,
      price: test.price,
      input: test.input,
      response: null,
      durationMs,
      success: false,
      error: err.message || String(err),
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🧪 x402 Individual Agent Integration Tests\n");
  console.log(`📋 Testing ${AGENT_TESTS.length} agents with real testnet payments\n`);

  // Setup payment client
  const { x402Fetch, walletAddress } = createPaymentFetch();

  // Start server
  await startServer();

  const results: TestResult[] = [];
  const overallStart = Date.now();

  try {
    // Run each agent test sequentially
    for (let i = 0; i < AGENT_TESTS.length; i++) {
      const test = AGENT_TESTS[i];
      const label = `[${i + 1}/${AGENT_TESTS.length}]`;

      process.stdout.write(
        `${label} Testing ${test.agent} (${test.price})... `,
      );

      const result = await runAgentTest(test, x402Fetch);
      results.push(result);

      if (result.success) {
        console.log(
          `✅ ${result.durationMs}ms (HTTP ${result.response?.status})`,
        );
      } else {
        console.log(
          `❌ ${result.durationMs}ms — ${result.error}`,
        );
      }
    }
  } finally {
    stopServer();
  }

  const totalDurationMs = Date.now() - overallStart;

  // Build summary
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const prices = AGENT_TESTS.map((t) =>
    parseFloat(t.price.replace("$", "")),
  );
  const totalCost = prices.reduce((sum, p) => sum + p, 0);

  const output = {
    timestamp: new Date().toISOString(),
    wallet: walletAddress,
    network: NETWORK,
    serverUrl: BASE_URL,
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      totalDurationMs,
      totalCostUSD: `$${totalCost.toFixed(3)}`,
    },
  };

  // Write results JSON
  const outputPath = join(import.meta.dir, "test-results.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("📊 SUMMARY");
  console.log("═".repeat(60));
  console.log(`   Total:    ${results.length} agents`);
  console.log(`   Passed:   ${passed} ✅`);
  console.log(`   Failed:   ${failed} ❌`);
  console.log(`   Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`   Cost:     ${output.summary.totalCostUSD} (testnet USDC)`);
  console.log(`   Results:  ${outputPath}`);
  console.log("═".repeat(60));

  if (failed > 0) {
    console.log("\n❌ Failed agents:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`   - ${r.agent}: ${r.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  stopServer();
  process.exit(1);
});
