---
sidebar_position: 1
title: Authentication
description: Authentication methods and configuration
---

# Authentication

BioAgents supports multiple authentication methods.

## Authentication Modes

Set `AUTH_MODE` in your environment:

| Mode | Description |
|------|-------------|
| `none` | No authentication required |
| `password` | Simple password protection |
| `jwt` | JWT token authentication |

## Password Authentication

```bash
AUTH_MODE=password
UI_PASSWORD=your-secure-password
```

## JWT Authentication

```bash
AUTH_MODE=jwt
BIOAGENTS_SECRET=your-jwt-secret
```

### Generating Tokens

```typescript
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { userId: 'user-123' },
  process.env.BIOAGENTS_SECRET,
  { expiresIn: '24h' }
);
```

### Using Tokens

Include the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/chat
```

## x402 Payment Authentication

BioAgents supports x402 protocol for payment-based authentication:

```bash
# Enable x402
X402_ENABLED=true
```

x402 enables pay-per-request access to the API using cryptocurrency payments.
