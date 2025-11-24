---
title: WebSocket API
sidebar_position: 3
---

# WebSocket API

Real-time bidirectional communication for streaming responses and live updates.

## Connection

Connect to the WebSocket endpoint:

```
ws://localhost:3000/ws
```

### Authentication

Send authentication message immediately after connection:

```json
{
  "type": "auth",
  "token": "your-jwt-token"
}
```

## Message Types

### Client → Server

#### Chat Message

```json
{
  "type": "chat",
  "data": {
    "message": "string",
    "sessionId": "string",
    "tools": ["string"]
  }
}
```

#### Research Request

```json
{
  "type": "research",
  "data": {
    "query": "string",
    "depth": "basic | intermediate | comprehensive"
  }
}
```

### Server → Client

#### Content Stream

```json
{
  "type": "content",
  "data": {
    "content": "string",
    "done": false
  }
}
```

#### Tool Execution

```json
{
  "type": "tool",
  "data": {
    "toolName": "string",
    "status": "started | completed | failed",
    "result": {}
  }
}
```

#### Error

```json
{
  "type": "error",
  "data": {
    "code": "string",
    "message": "string"
  }
}
```

## JavaScript Example

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// Authenticate
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-jwt-token'
  }));
};

// Handle messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'content':
      console.log('AI:', message.data.content);
      break;
    case 'tool':
      console.log('Tool:', message.data.toolName, message.data.status);
      break;
    case 'error':
      console.error('Error:', message.data.message);
      break;
  }
};

// Send a message
ws.send(JSON.stringify({
  type: 'chat',
  data: {
    message: 'Explain protein folding',
    sessionId: 'session-123'
  }
}));
```

## Python Example

```python
import websocket
import json

def on_message(ws, message):
    data = json.loads(message)
    if data['type'] == 'content':
        print(f"AI: {data['data']['content']}")

def on_open(ws):
    # Authenticate
    ws.send(json.dumps({
        'type': 'auth',
        'token': 'your-jwt-token'
    }))
    
    # Send message
    ws.send(json.dumps({
        'type': 'chat',
        'data': {
            'message': 'Explain protein folding',
            'sessionId': 'session-123'
        }
    }))

ws = websocket.WebSocketApp(
    'ws://localhost:3000/ws',
    on_message=on_message,
    on_open=on_open
)

ws.run_forever()
```

## Connection Management

### Heartbeat

The server sends periodic ping messages. Clients should respond with pong:

```json
// Server → Client
{ "type": "ping" }

// Client → Server
{ "type": "pong" }
```

### Reconnection

Implement exponential backoff for reconnection:

```javascript
let reconnectDelay = 1000;

function connect() {
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  ws.onclose = () => {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  };
  
  ws.onopen = () => {
    reconnectDelay = 1000; // Reset on successful connection
  };
}
```

## Best Practices

1. **Always authenticate** immediately after connection
2. **Handle disconnections** gracefully with automatic reconnection
3. **Implement timeouts** for long-running operations
4. **Buffer messages** during disconnection and replay on reconnect
5. **Validate** all incoming messages before processing
6. **Use sessionId** consistently to maintain conversation context

## Next Steps

- [REST API Reference](./rest-api) - HTTP endpoints
- [Tools Reference](./tools) - Available AI tools

