/**
 * Request testnet tokens from CDP faucet
 * 
 * Required env: X402_TEST_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

// Derive wallet address from private key
const PRIVATE_KEY = process.env.X402_TEST_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ X402_TEST_PRIVATE_KEY not set in environment");
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk as `0x${string}`);
const TEST_WALLET = account.address;

async function requestFaucet() {
  console.log("Initializing CDP client...");
  
  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
  });

  console.log(`Test wallet: ${TEST_WALLET}`);
  
  console.log(`\nRequesting ETH for ${TEST_WALLET}...`);
  try {
    const ethResp = await cdp.evm.requestFaucet({
      address: TEST_WALLET,
      network: "base-sepolia",
      token: "eth",
    });
    console.log(`✅ ETH faucet tx: ${ethResp.transactionHash}`);
    console.log(`   Explorer: https://sepolia.basescan.org/tx/${ethResp.transactionHash}`);
  } catch (e: any) {
    console.error(`❌ ETH faucet error: ${e.message}`);
  }

  console.log(`\nRequesting USDC for ${TEST_WALLET}...`);
  try {
    const usdcResp = await cdp.evm.requestFaucet({
      address: TEST_WALLET,
      network: "base-sepolia",
      token: "usdc",
    });
    console.log(`✅ USDC faucet tx: ${usdcResp.transactionHash}`);
    console.log(`   Explorer: https://sepolia.basescan.org/tx/${usdcResp.transactionHash}`);
  } catch (e: any) {
    console.error(`❌ USDC faucet error: ${e.message}`);
  }

  console.log("\nDone! Tokens should arrive shortly.");
}

requestFaucet().catch(console.error);
