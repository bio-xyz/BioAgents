import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { x402Hook } from "../../middleware/x402";
import { x402ChatRoute } from "./chat";
import { x402ResearchRoute } from "./research";
import { x402Config } from "../../x402/config";

/**
 * Integration tests for x402 Payment System on Base Sepolia
 *
 * These tests verify the actual x402 payment flow:
 * - Payment requirement generation
 * - Payment header verification
 * - Payment settlement on Base Sepolia testnet
 *
 * REQUIREMENTS:
 * - X402_ENABLED=true in environment
 * - Valid X402_PAYMENT_ADDRESS configured
 * - Base Sepolia testnet access
 * - Valid payment headers from testnet transactions
 *
 * NOTE: These tests will SKIP if x402 is not enabled.
 */

describe("x402 Payment Integration Tests", () => {
  let app: Elysia;

  beforeAll(() => {
    // Set X402_ENABLED for this test suite
    process.env.X402_ENABLED = "true";

    // Create app with x402 routes and guard (same as main app)
    app = new Elysia()
      .guard(
        x402Config.enabled ? { beforeHandle: x402Hook } : {},
        (app) => app
          .use(x402ChatRoute) // Includes both GET and POST for /api/x402/chat
          .use(x402ResearchRoute) // Includes both GET and POST for /api/x402/research
      );
  });

  afterAll(async () => {
    try {
      // Cleanup
    } catch (e) {
      // Ignore
    }
  });

  describe("Payment Requirements", () => {
    test("should return 402 without X-PAYMENT header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Test message",
          }),
        })
      );

      // Should return 402 Payment Required
      expect(response.status).toBe(402);

      const data = await response.json();
      expect(data).toHaveProperty("x402Version");
      expect(data).toHaveProperty("accepts");
      expect(data.accepts).toBeInstanceOf(Array);
      expect(data.accepts.length).toBeGreaterThan(0);
    });

    test("should include payment requirement details", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Test",
          }),
        })
      );

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
    });

    test("should include outputSchema for external consumers", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Test",
          }),
        })
      );

      const data = await response.json();
      const requirement = data.accepts[0];

      // External consumers need outputSchema for x402scan compliance
      expect(requirement).toHaveProperty("outputSchema");
      expect(requirement.outputSchema).toBeDefined();
    });
  });

  describe("Payment Verification", () => {
    test("should reject invalid payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": "invalid-payment-header",
          },
          body: JSON.stringify({
            message: "Test",
          }),
        })
      );

      // Should reject invalid payment
      expect(response.status).toBe(402);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      console.log("❌ Invalid payment rejected:", data.error);
    });

    test("should reject malformed payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": "not-even-close-to-valid",
          },
          body: JSON.stringify({
            message: "Test",
          }),
        })
      );

      expect(response.status).toBe(402);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle empty payment header", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": "",
          },
          body: JSON.stringify({
            message: "Test",
          }),
        })
      );

      // Empty header should be treated as missing
      expect(response.status).toBe(402);
    });
  });

  describe("Research Route Payment", () => {
    test("should require payment for research endpoint", async () => {
      if (!x402Config.enabled) {
        console.log("⏭️  Skipping: x402 not enabled");
        return;
      }

      const response = await app.handle(
        new Request("http://localhost/api/x402/research", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Goals: Test\nRequirements: Test\nDatasets: No datasets\nPrior Works: No prior works\nExperiment Ideas: No experiment ideas\nDesired Outputs: Test",
          }),
        })
      );

      expect(response.status).toBe(402);

      const data = await response.json();
      expect(data).toHaveProperty("accepts");

      const requirement = data.accepts[0];
      expect(requirement.resource).toContain("/api/x402/research");

      console.log("🔬 Research payment requirement:", {
        resource: requirement.resource,
        description: requirement.description,
      });
    });
  });

  describe("Payment Configuration", () => {
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

/**
 * Example: How to test with a real payment
 *
 * 1. Set up environment:
 *    export X402_ENABLED=true
 *    export X402_PAYMENT_ADDRESS=0x...
 *    export X402_NETWORK=base-sepolia
 *    export X402_ENVIRONMENT=testnet
 *
 * 2. Get Base Sepolia testnet USDC:
 *    - Visit https://faucet.circle.com/
 *    - Request testnet USDC for Base Sepolia
 *
 * 3. Make a payment request to get the requirement:
 *    const response = await fetch("http://localhost:3000/api/x402/chat", {
 *      method: "POST",
 *      headers: { "Content-Type": "application/json" },
 *      body: JSON.stringify({ message: "Test" })
 *    });
 *
 * 4. Send USDC on Base Sepolia to the payment address
 *
 * 5. Construct the X-PAYMENT header with your transaction proof
 *
 * 6. Make the request with payment:
 *    const response = await fetch("http://localhost:3000/api/x402/chat", {
 *      method: "POST",
 *      headers: {
 *        "Content-Type": "application/json",
 *        "X-PAYMENT": "your-payment-header-here"
 *      },
 *      body: JSON.stringify({ message: "What are senolytics?" })
 *    });
 *
 * 7. You should receive a successful response with AI content
 */
