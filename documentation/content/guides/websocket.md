---
sidebar_position: 5
title: WebSocket Events
description: Real-time updates and subscribing to notifications
---

# WebSocket Events

BioAgents provides real-time updates via WebSocket connections. Subscribe to notifications for live progress during research sessions.

## Connecting

```javascript
const ws = new WebSocket('wss://api.bioagents.xyz/ws');

ws.onopen = () => {
  console.log('Connected to BioAgents');

  // Subscribe to a conversation
  ws.send(JSON.stringify({
    type: 'subscribe',
    conversationId: 'conv_123456'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected');
};
```

## Authentication

Include your auth token when connecting:

```javascript
const ws = new WebSocket('wss://api.bioagents.xyz/ws', [], {
  headers: {
    'Authorization': 'Bearer <token>'
  }
});
```

Or send auth after connecting:

```javascript
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    token: '<your-token>'
  }));
};
```

## Event Types

### Research Events

| Event | Description |
|-------|-------------|
| `research:started` | Research session began |
| `research:planning` | Planning agent working |
| `research:task_started` | Individual task started |
| `research:task_completed` | Individual task finished |
| `research:hypothesis` | Hypothesis generated |
| `research:completed` | Research session finished |
| `research:failed` | Research encountered error |

### File Events

| Event | Description |
|-------|-------------|
| `file:processing` | File processing started |
| `file:ready` | File processed successfully |
| `file:error` | File processing failed |

### Chat Events

| Event | Description |
|-------|-------------|
| `chat:started` | Chat response generation started |
| `chat:streaming` | Streaming response chunk |
| `chat:completed` | Chat response finished |

## Event Payloads

### research:started

```json
{
  "type": "research:started",
  "conversationId": "conv_123456",
  "messageId": "msg_xyz789",
  "timestamp": "2025-12-18T10:00:00Z"
}
```

### research:task_completed

```json
{
  "type": "research:task_completed",
  "conversationId": "conv_123456",
  "task": {
    "type": "LITERATURE",
    "objective": "Search for p53 pathway studies",
    "start": "2025-12-18T10:01:00Z",
    "end": "2025-12-18T10:03:00Z",
    "output": "Found 15 relevant papers..."
  }
}
```

### research:completed

```json
{
  "type": "research:completed",
  "conversationId": "conv_123456",
  "messageId": "msg_xyz789",
  "result": {
    "hypothesis": "Based on the literature...",
    "keyInsights": ["Insight 1", "Insight 2"],
    "reply": "Full response text..."
  },
  "timestamp": "2025-12-18T10:15:00Z"
}
```

### file:ready

```json
{
  "type": "file:ready",
  "conversationId": "conv_123456",
  "fileId": "file_abc123",
  "filename": "gene_expression.csv",
  "description": "CSV file containing..."
}
```

## Subscribing to Conversations

Subscribe to receive events for specific conversations:

```javascript
// Subscribe
ws.send(JSON.stringify({
  type: 'subscribe',
  conversationId: 'conv_123456'
}));

// Unsubscribe
ws.send(JSON.stringify({
  type: 'unsubscribe',
  conversationId: 'conv_123456'
}));
```

## React Example

```jsx
import { useEffect, useState, useCallback } from 'react';

function useResearchUpdates(conversationId) {
  const [status, setStatus] = useState('idle');
  const [tasks, setTasks] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const ws = new WebSocket('wss://api.bioagents.xyz/ws');

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        conversationId
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'research:started':
          setStatus('processing');
          break;

        case 'research:task_completed':
          setTasks(prev => [...prev, data.task]);
          break;

        case 'research:completed':
          setStatus('completed');
          setResult(data.result);
          break;

        case 'research:failed':
          setStatus('failed');
          break;
      }
    };

    return () => ws.close();
  }, [conversationId]);

  return { status, tasks, result };
}
```

## Reconnection

Handle disconnections gracefully:

```javascript
function createWebSocket() {
  const ws = new WebSocket('wss://api.bioagents.xyz/ws');

  ws.onclose = () => {
    console.log('Disconnected, reconnecting in 3s...');
    setTimeout(createWebSocket, 3000);
  };

  return ws;
}
```

## Heartbeat

Send periodic pings to keep the connection alive:

```javascript
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);
```

## Error Handling

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'error') {
    console.error('Server error:', data.message);
    // Handle error appropriately
  }
};
```

Common errors:

| Error | Description |
|-------|-------------|
| `unauthorized` | Invalid or missing auth token |
| `invalid_subscription` | Conversation not found |
| `rate_limited` | Too many messages |
