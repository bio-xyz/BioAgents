/**
 * x402 v2 End-to-End Payment Test
 * Tests payment flow on configured network
 * 
 * Required env: X402_TEST_PRIVATE_KEY
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Load from environment - never hardcode private keys!
const PRIVATE_KEY = process.env.X402_TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ X402_TEST_PRIVATE_KEY not set in environment");
  process.exit(1);
}

const API_URL = process.env.X402_TEST_API_URL || "http://localhost:3333/api/x402/chat";
const NETWORK = process.env.X402_NETWORK || "eip155:84532"; // Default to testnet

async function testPayment() {
  console.log("🧪 x402 v2 Payment Test\n");
  
  // Create account from private key
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`💳 Wallet: ${account.address}`);
  console.log(`🌐 Network: ${NETWORK}`);

  // Create x402 client and register EVM scheme
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: account,
    networks: [NETWORK],
  });
  
  // Wrap fetch with x402 payment handling
  const x402Fetch = wrapFetchWithPayment(fetch, client);

  console.log(`\n📡 Calling: ${API_URL}`);

  try {
    const response = await x402Fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Hello! This is a test message via x402 payment.",
      }),
    });

    console.log(`📬 Response status: ${response.status}`);
    
    const data = await response.json();
    console.log(`\n✅ Response:`, JSON.stringify(data, null, 2));
    
    // Check for payment response header
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log(`\n💸 Payment Response:`, JSON.stringify(decoded, null, 2));
    }
    
  } catch (error) {
    console.error(`\n❌ Error:`, error);
  }
}

testPayment();
