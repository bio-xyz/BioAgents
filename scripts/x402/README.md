# x402 Payment Test Scripts

Utility scripts for testing x402 payment integration.

## Prerequisites

Set the following environment variables (or add to `.env`):

```bash
X402_TEST_PRIVATE_KEY=0x...  # Test wallet private key
CDP_API_KEY_ID=...           # For faucet requests
CDP_API_KEY_SECRET=...       # For faucet requests
```

## Scripts

### test-x402-payment.ts
General payment test for the configured network (testnet by default).

```bash
bun run scripts/x402/test-x402-payment.ts
```

### test-x402-mainnet.ts
Mainnet-specific test using CDP facilitator.

```bash
bun run scripts/x402/test-x402-mainnet.ts
```

### request-faucet.ts
Request testnet tokens (ETH + USDC) from CDP faucet.

```bash
bun run scripts/x402/request-faucet.ts
```

## Notes

- Never commit private keys to source files
- All scripts read credentials from environment variables
- Testnet: Base Sepolia (eip155:84532)
- Mainnet: Base (eip155:8453)
