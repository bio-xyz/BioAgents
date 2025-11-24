---
title: API Overview
sidebar_position: 1
---

import ApiTester from '@site/src/components/ApiTester';

# API Overview

BioAgents provides a comprehensive REST API and WebSocket interface for building AI-powered scientific research applications.

## Try It Live

Test the API directly from this page:

<ApiTester 
  endpoint="/api/chat"
  method="POST"
  description="Send a message to the AI agent and receive a response"
/>

## Base URL

```
Development: http://localhost:3000
Production: https://api.bioagents.io
```

## Authentication

All API requests require authentication using JWT tokens:

```bash
Authorization: Bearer <your-jwt-token>
```

Get your token by logging in through the `/api/auth/login` endpoint.

## OpenAPI Specification

The complete API specification is available in OpenAPI 3.0 format:

- **[Download OpenAPI Spec](pathname:///openapi.yaml)** - Use this with Postman, Insomnia, or any OpenAPI-compatible tool
- **[View in Swagger UI](https://editor.swagger.io/)** - Paste the spec for interactive documentation

## API Categories

### 🧠 Chat & Conversation
- Send messages to AI agents
- Stream responses in real-time
- Manage conversation sessions

### 🔬 Deep Research
- Start comprehensive research tasks
- Track research progress
- Retrieve research results

### 👤 Authentication
- User login and registration
- Session management
- Token refresh

### 💳 x402 Payments
- Verify blockchain payments
- Check payment status
- Manage payment credits

## Quick Start

### 1. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your-password"
  }'
```

### 2. Send a Chat Message

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "Explain protein folding",
    "sessionId": "your-session-id"
  }'
```

### 3. Start Deep Research

```bash
curl -X POST http://localhost:3000/api/deep-research/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "query": "Latest CRISPR developments in cancer treatment",
    "depth": "comprehensive"
  }'
```

## Rate Limiting

API requests are rate limited based on your subscription tier:

- **Free:** 100 requests/hour
- **Pro:** 1,000 requests/hour
- **Enterprise:** Custom limits

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication token missing or invalid |
| `INVALID_INPUT` | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `SERVER_ERROR` | Internal server error |

## SDK Support

Official SDKs are coming soon for:
- JavaScript/TypeScript
- Python
- Go
- Rust

## Next Steps

- [REST API Reference](./rest-api) - Detailed endpoint documentation
- [WebSocket API](./websocket) - Real-time communication
- [Tools Reference](./tools) - Available AI tools

