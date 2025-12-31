---
sidebar_position: 6
title: x402 Payments
description: Pay-per-request integration with cryptocurrency
---

# x402 Payments

BioAgents supports the x402 protocol for pay-per-request access using cryptocurrency. This enables usage-based billing without traditional API keys.

## What is x402?

x402 is a payment protocol that enables:

- **Pay-per-request** - Pay only for what you use
- **No accounts** - Access API with just a wallet
- **Cryptocurrency** - Pay with supported tokens
- **Instant access** - No approval process

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                       Client                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ 1. Request without payment
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     BioAgents API                            │
│                                                              │
│   Returns 402 Payment Required                               │
│   + Payment details (amount, address, token)                │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ 2. 402 response with payment info
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Client                                 │
│                                                              │
│   Creates and signs payment                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ 3. Request with X-402 header
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     BioAgents API                            │
│                                                              │
│   Verifies payment → Processes request                      │
└─────────────────────────────────────────────────────────────┘
```

## Enabling x402

Set the environment variable:

```bash
X402_ENABLED=true
```

## Making Requests

### Step 1: Initial Request

```bash
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "Content-Type: application/json" \
  -d '{"message": "Research longevity pathways"}'
```

### Step 2: Receive 402 Response

```json
{
  "status": 402,
  "error": "Payment Required",
  "payment": {
    "amount": "0.001",
    "token": "USDC",
    "chain": "base",
    "recipient": "0x1234...5678",
    "memo": "deep-research-request"
  }
}
```

### Step 3: Submit with Payment

```bash
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "Content-Type: application/json" \
  -H "X-402-Payment: <signed-payment-proof>" \
  -d '{"message": "Research longevity pathways"}'
```

## Pricing

| Endpoint | Cost |
|----------|------|
| `/api/chat` | 0.0001 USDC |
| `/api/deep-research/start` | 0.001 USDC |
| `/api/files/request-upload` | 0.0001 USDC |

## Supported Tokens

| Token | Chain |
|-------|-------|
| USDC | Base |
| ETH | Base |

## JavaScript SDK

```javascript
import { x402Client } from '@bioagents/sdk';

const client = x402Client({
  baseUrl: 'https://api.bioagents.xyz',
  wallet: yourWalletProvider
});

// Automatically handles 402 responses
const result = await client.deepResearch({
  message: 'Research longevity pathways'
});
```

## Wallet Integration

### Using ethers.js

```javascript
import { ethers } from 'ethers';

async function makePayment(paymentDetails) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // Create payment proof
  const message = JSON.stringify({
    amount: paymentDetails.amount,
    token: paymentDetails.token,
    recipient: paymentDetails.recipient,
    memo: paymentDetails.memo,
    timestamp: Date.now()
  });

  const signature = await signer.signMessage(message);

  return {
    message,
    signature,
    address: await signer.getAddress()
  };
}
```

### Using viem

```javascript
import { createWalletClient, custom } from 'viem';
import { base } from 'viem/chains';

const client = createWalletClient({
  chain: base,
  transport: custom(window.ethereum)
});

async function signPayment(paymentDetails) {
  const [address] = await client.getAddresses();

  const signature = await client.signMessage({
    account: address,
    message: JSON.stringify(paymentDetails)
  });

  return { signature, address };
}
```

## User Identification

x402 users are identified by their wallet address:

```json
{
  "userId": "0x1234...5678",
  "authMethod": "x402",
  "wallet": "0x1234...5678"
}
```

## Conversation Continuity

Conversations are tied to wallet addresses. Use the same wallet to continue research:

```bash
# First request creates conversation
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "X-402-Payment: <payment>" \
  -d '{"message": "Research senescence"}'

# Response includes conversationId
# {"conversationId": "conv_123", ...}

# Continue with same wallet
curl -X POST "https://api.bioagents.xyz/api/deep-research/start" \
  -H "X-402-Payment: <payment>" \
  -d '{
    "message": "Focus on SASP factors",
    "conversationId": "conv_123"
  }'
```

## Error Handling

| Error | Description | Solution |
|-------|-------------|----------|
| `insufficient_funds` | Wallet balance too low | Add funds to wallet |
| `invalid_signature` | Payment signature invalid | Re-sign payment |
| `payment_expired` | Payment proof too old | Generate new payment |
| `unsupported_token` | Token not supported | Use USDC or ETH |

## Testing

Use testnet for development:

```bash
X402_TESTNET=true
```

This uses Base Sepolia testnet tokens.
