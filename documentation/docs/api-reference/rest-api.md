---
title: REST API
sidebar_position: 2
---

# REST API Reference

Complete reference for all REST API endpoints.

## Authentication Endpoints

### POST /api/auth/login

Authenticate a user and receive a JWT token.

**Request Body:**

```json
{
  "email": "string (required)",
  "password": "string (required)"
}
```

**Response:**

```json
{
  "token": "string",
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "createdAt": "string (ISO 8601)"
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "scientist@example.com",
    "password": "securePassword123"
  }'
```

---

## Chat Endpoints

### POST /api/chat

Send a message to the AI agent and receive a streaming response.

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json`

**Request Body:**

```json
{
  "message": "string (required)",
  "sessionId": "string (optional)",
  "context": {
    "fileIds": ["string"] // Optional uploaded file IDs
  },
  "tools": ["string"] // Optional: specific tools to enable
}
```

**Response:**

Server-Sent Events (SSE) stream with events:

```json
// Content chunk
{
  "type": "content",
  "content": "string"
}

// Tool call
{
  "type": "tool_call",
  "toolName": "string",
  "toolArgs": {}
}

// Thinking process
{
  "type": "thinking",
  "content": "string"
}

// Completion
{
  "type": "complete"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -N \
  -d '{
    "message": "Analyze this protein sequence: MVHLTPEEKS",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "tools": ["semanticScholar", "hypothesisGeneration"]
  }'
```

---

## Deep Research Endpoints

### POST /api/deep-research/start

Initiate a comprehensive research task on a scientific topic.

**Headers:**
- `Authorization: Bearer <token>` (required)

**Request Body:**

```json
{
  "query": "string (required)",
  "sessionId": "string (optional)",
  "depth": "basic | intermediate | comprehensive (default: intermediate)"
}
```

**Response:**

```json
{
  "taskId": "string",
  "status": "started | in_progress",
  "estimatedDuration": 300 // seconds
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/deep-research/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "query": "What are the latest developments in CRISPR gene editing for cancer treatment?",
    "depth": "comprehensive"
  }'
```

---

### GET /api/deep-research/status/:taskId

Check the current status and progress of a deep research task.

**Headers:**
- `Authorization: Bearer <token>` (required)

**Path Parameters:**
- `taskId` - The research task ID returned from `/start`

**Response:**

```json
{
  "taskId": "string",
  "status": "started | in_progress | completed | failed",
  "progress": 75, // 0-100
  "currentStep": "Analyzing papers...",
  "results": {
    // Only present when status is "completed"
    "summary": "string",
    "sources": ["string"],
    "insights": ["string"]
  }
}
```

**Example:**

```bash
curl -X GET http://localhost:3000/api/deep-research/status/abc123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## x402 Payment Endpoints

### POST /api/x402/verify

Verify a payment made through the x402 protocol.

**Headers:**
- `Authorization: Bearer <token>` (required)

**Request Body:**

```json
{
  "paymentId": "string (required)",
  "transactionHash": "string (required)"
}
```

**Response:**

```json
{
  "verified": true,
  "amount": "0.001 ETH",
  "timestamp": "2024-11-24T10:30:00Z"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/x402/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "paymentId": "pay_abc123",
    "transactionHash": "0x1234..."
  }'
```

---

## File Upload Endpoints

### POST /api/upload

Upload a file for analysis (PDF, TXT, CSV, etc.).

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: multipart/form-data`

**Form Data:**
- `file` - The file to upload (required)
- `type` - File type hint: `paper | data | image` (optional)

**Response:**

```json
{
  "fileId": "string",
  "filename": "string",
  "size": 1024000, // bytes
  "type": "string",
  "uploadedAt": "2024-11-24T10:30:00Z"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@paper.pdf" \
  -F "type=paper"
```

---

## Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |

## Next Steps

- [WebSocket API](./websocket) - Real-time streaming
- [Tools Reference](./tools) - Available AI tools
- [OpenAPI Spec](pathname:///openapi.yaml) - Complete machine-readable specification

