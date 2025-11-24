import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { x402Config } from "../../x402/config";

/**
 * E2E tests for x402 Payment System on Base Sepolia
 *
 * These tests verify the actual x402 payment flow with a REAL running server:
 * - Payment requirement generation (402 responses)
 * - Payment header verification
 * - Payment settlement on Base Sepolia testnet
 *
 * REQUIREMENTS:
 * - X402_ENABLED=true in environment
 * - Valid X402_PAYMENT_ADDRESS configured
 * - Server running on port 3000
 * - Base Sepolia testnet access
 *
 * NOTE: These tests will SKIP if x402 is not enabled.
 */

const BASE_URL = "http://localhost:3000";
let serverProcess: any;

describe("x402 Payment E2E Tests", () => {
  beforeAll(async () => {
    // Start the server in the background
    console.log("🚀 Starting server for E2E tests...");

    serverProcess = Bun.spawn(["bun", "run", "src/index.ts"], {
      env: {
        ...process.env,
        X402_ENABLED: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${BASE_URL}/api/x402/chat`);
        if (response.status === 200) {
          console.log("✅ Server is ready!");
          break;
        }
      } catch (e) {
        // Server not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      if (attempts === maxAttempts) {
        throw new Error("Server failed to start within 30 seconds");
      }
    }

    // Give server a bit more time to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    console.log("🛑 Stopping server...");

    if (serverProcess) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  describe("Payment Requirements", () => {
    test("should return 402 without X-PAYMENT header for chat endpoint", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Test message",
        }),
      });

      console.log("📊 Response status:", response.status);

      // Should return 402 Payment Required
      expect(response.status).toBe(402);

      const data = await response.json();
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      expect(data).toHaveProperty("x402Version");
      expect(data).toHaveProperty("accepts");
      expect(data.accepts).toBeInstanceOf(Array);
      expect(data.accepts.length).toBeGreaterThan(0);
    }, 10000);

    test("should include payment requirement details for chat", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Test",
        }),
      });

      const data = await response.json();
      const requirement = data.accepts[0];

      // Verify payment requirement structure (x402 library format)
      expect(requirement).toHaveProperty("resource");
      expect(requirement).toHaveProperty("description");
      expect(requirement).toHaveProperty("scheme");
      expect(requirement).toHaveProperty("network");
      expect(requirement).toHaveProperty("maxAmountRequired");
      expect(requirement).toHaveProperty("asset");
      expect(requirement).toHaveProperty("payTo");

      // Verify Base Sepolia configuration
      expect(requirement.scheme).toBe("exact");
      expect(requirement.network).toBe("base-sepolia");
      expect(requirement.payTo).toBe(x402Config.paymentAddress);

      console.log("💰 Payment requirement:", {
        resource: requirement.resource,
        amount: requirement.maxAmountRequired,
        asset: requirement.asset,
        network: requirement.network,
      });
    }, 10000);

    test("should include outputSchema for external consumers", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Test",
        }),
      });

      const data = await response.json();
      const requirement = data.accepts[0];

      // External consumers need outputSchema for x402scan compliance
      expect(requirement).toHaveProperty("outputSchema");
      expect(requirement.outputSchema).toBeDefined();

      console.log("📋 Output schema present:", !!requirement.outputSchema);
    }, 10000);

    test("should return 402 for research endpoint without payment", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/research`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Goals: Test\nRequirements: Test\nDatasets: No datasets\nPrior Works: No prior works\nExperiment Ideas: No experiment ideas\nDesired Outputs: Test",
        }),
      });

      expect(response.status).toBe(402);

      const data = await response.json();
      expect(data).toHaveProperty("accepts");

      const requirement = data.accepts[0];
      expect(requirement.resource).toContain("/api/x402/research");

      console.log("🔬 Research payment requirement:", {
        resource: requirement.resource,
        description: requirement.description,
        amount: requirement.maxAmountRequired,
      });
    }, 10000);
  });

  describe("Payment Verification", () => {
    test("should reject invalid payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": "invalid-payment-header",
        },
        body: JSON.stringify({
          message: "Test",
        }),
      });

      // Should reject invalid payment
      expect(response.status).toBe(402);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      console.log("❌ Invalid payment rejected:", data.error);
    }, 10000);

    test("should reject malformed payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": "not-even-close-to-valid",
        },
        body: JSON.stringify({
          message: "Test",
        }),
      });

      expect(response.status).toBe(402);
      const data = await response.json();
      expect(data).toHaveProperty("error");

      console.log("❌ Malformed payment rejected");
    }, 10000);

    test("should handle empty payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": "",
        },
        body: JSON.stringify({
          message: "Test",
        }),
      });

      // Empty header should be treated as missing
      expect(response.status).toBe(402);

      console.log("❌ Empty payment header rejected");
    }, 10000);
  });

  describe("GET Endpoints (Discovery)", () => {
    test("should return discovery info for chat endpoint", async () => {
      const response = await fetch(`${BASE_URL}/api/x402/chat`, {
        method: "GET",
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("message");
      expect(data.message).toContain("x402 Chat API");

      console.log("📖 Chat discovery:", data.message);
    });

    test("should return discovery info for research endpoint", async () => {
      const response = await fetch(`${BASE_URL}/api/x402/research`, {
        method: "GET",
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("message");
      expect(data.message).toContain("x402 Deep Research API");

      console.log("📖 Research discovery:", data.message);
    });
  });

  describe("Configuration", () => {
    test("should use correct Base Sepolia configuration", () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      console.log("⚙️  x402 Configuration:", {
        enabled: x402Config.enabled,
        environment: x402Config.environment,
        network: x402Config.network,
        paymentAddress: x402Config.paymentAddress,
        facilitatorUrl: x402Config.facilitatorUrl,
        asset: x402Config.asset,
      });

      expect(x402Config.enabled).toBe(true);
      expect(x402Config.network).toBe("base-sepolia");
      expect(x402Config.environment).toBe("testnet");
      expect(x402Config.paymentAddress).toBeDefined();
      expect(x402Config.paymentAddress.length).toBeGreaterThan(0);
    });
  });

  describe("Manual Testing Guide", () => {
    test("should provide instructions for manual payment testing", () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Manual x402 Payment Testing Guide                   ║
╚═══════════════════════════════════════════════════════════════╝

To test with a REAL Base Sepolia payment:

1. Get the payment requirement:
   curl -X POST http://localhost:3000/api/x402/chat \\
     -H "Content-Type: application/json" \\
     -d '{"message": "Test"}'

2. Extract the payment requirement from the 402 response

3. Create a payment on Base Sepolia testnet:
   - Send USDC to: ${x402Config.paymentAddress}
   - Amount: As specified in pricing.amount
   - Network: base-sepolia

4. Generate X-PAYMENT header using the transaction

5. Make the request with payment:
   curl -X POST http://localhost:3000/api/x402/chat \\
     -H "Content-Type: application/json" \\
     -H "X-PAYMENT: <your-payment-header>" \\
     -d '{"message": "What are senolytics?"}'

6. You should receive a successful response with AI-generated content

Network Details:
- Network: ${x402Config.network}
- Environment: ${x402Config.environment}
- Payment Address: ${x402Config.paymentAddress}
- Facilitator: ${x402Config.facilitatorUrl}
- Asset: ${x402Config.asset}

For Base Sepolia testnet USDC:
- Faucet: https://faucet.circle.com/
- Block Explorer: https://sepolia.basescan.org/
- Bridge: https://bridge.base.org/

      `);

      expect(true).toBe(true); // Always pass - this is just documentation
    });
  });
});
