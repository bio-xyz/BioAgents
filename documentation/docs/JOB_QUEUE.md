# BullMQ Job Queue System

BioAgents uses [BullMQ](https://docs.bullmq.io/) for reliable background job processing. This enables horizontal scaling, job persistence, automatic retries, and real-time progress notifications.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Running Modes](#running-modes)
- [Configuration](#configuration)
- [Docker Deployment](#docker-deployment)
- [Queue Details](#queue-details)
- [WebSocket Notifications](#websocket-notifications)
- [Monitoring](#monitoring)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client (Browser)                                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
            ┌───────────────┐            ┌───────────────┐
            │  HTTP Request │            │   WebSocket   │
            │  POST /api/*  │            │   /api/ws     │
            └───────┬───────┘            └───────┬───────┘
                    │                             │
                    ▼                             │
┌───────────────────────────────────────────────────────────────────────────┐
│                           API Server (Elysia)                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │  Route Handler  │──│  Queue Client   │  │  WebSocket Handler      │   │
│  │                 │  │  (enqueue job)  │  │  (subscribe/broadcast)  │   │
│  └─────────────────┘  └────────┬────────┘  └────────────┬────────────┘   │
└────────────────────────────────┼───────────────────────┼─────────────────┘
                                 │                        │
                                 ▼                        │
┌───────────────────────────────────────────────────────────────────────────┐
│                              Redis                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │  chat queue     │  │ deep-research   │  │  Pub/Sub Channels       │   │
│  │  (BullMQ)       │  │ queue (BullMQ)  │  │  conversation:{id}      │◄──┤
│  └────────┬────────┘  └────────┬────────┘  └─────────────────────────┘   │
└───────────┼────────────────────┼─────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         Worker Process(es)                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │  Chat Worker    │  │ Deep Research   │  │  Notification Publisher │   │
│  │  (concurrency:5)│  │ (concurrency:3) │  │  (Redis Pub/Sub)        │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Request**: Client sends HTTP request to API server
2. **Enqueue**: API server creates job in Redis queue, returns job ID immediately
3. **Process**: Worker picks up job, processes it, updates database
4. **Notify**: Worker publishes progress via Redis Pub/Sub
5. **Broadcast**: API server receives notification, broadcasts to WebSocket clients
6. **Fetch**: Client receives notification, fetches updated data via HTTP

This is the **"Notify + Fetch"** pattern - notifications are lightweight (just IDs), actual data is fetched via REST API.

## Running Modes

### In-Process Mode (Development)

Jobs execute directly in the API server process. Simple but not scalable.

```bash
# No Redis required
USE_JOB_QUEUE=false bun run dev
```

### Queue Mode (Production)

Jobs are processed by separate worker processes. Requires Redis.

```bash
# Terminal 1: Start Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Terminal 2: API Server
USE_JOB_QUEUE=true bun run dev

# Terminal 3: Worker
USE_JOB_QUEUE=true bun run worker
```

## Configuration

### Environment Variables

```bash
# Enable job queue (required for queue mode)
USE_JOB_QUEUE=true

# Redis connection
REDIS_URL=redis://localhost:6379
# OR individual settings:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=your-password

# Worker concurrency
CHAT_QUEUE_CONCURRENCY=5          # Parallel chat jobs per worker
DEEP_RESEARCH_QUEUE_CONCURRENCY=3 # Parallel research jobs per worker

# Rate limiting (optional)
CHAT_RATE_LIMIT_PER_MINUTE=10
DEEP_RESEARCH_RATE_LIMIT_PER_5MIN=3
```

### Redis Memory

Configure Redis memory based on expected load:

| Scenario | Memory | Concurrent Jobs |
|----------|--------|-----------------|
| Development | 256MB | ~50 |
| Light Production | 512MB | ~100 |
| Medium Production | 1GB | ~500 |
| Heavy Production | 2GB+ | 1000+ |

Deep research jobs have larger payloads (literature results, analysis data), so they consume more memory per job.

## Docker Deployment

### Production Stack

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f bioagents  # API server
docker compose logs -f worker     # Worker
docker compose logs -f redis      # Redis

# Scale workers
docker compose up -d --scale worker=3
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `bioagents` | 3000 | API server + WebSocket |
| `worker` | - | Job processor (no port) |
| `redis` | 6379 | Message broker |

### docker-compose.yml

The default `docker-compose.yml` includes:
- API server with health checks
- Worker with auto-restart
- Redis with persistence (`appendonly yes`)
- Shared volumes for docs

### Simple Mode (No Queue)

For single-instance deployments without Redis:

```bash
docker compose -f docker-compose.simple.yml up -d
```

## Queue Details

### Chat Queue

For `/api/chat` requests.

| Setting | Value |
|---------|-------|
| Concurrency | 5 (configurable) |
| Retry Attempts | 3 |
| Retry Backoff | Exponential (1s → 2s → 4s) |
| Job Retention | 1 hour (completed), 24 hours (failed) |

### Deep Research Queue

For `/api/deep-research/start` requests.

| Setting | Value |
|---------|-------|
| Concurrency | 3 (configurable) |
| Retry Attempts | 2 |
| Retry Backoff | Exponential (5s → 10s) |
| Job Retention | 24 hours (completed), 7 days (failed) |
| Timeout | None (can run 30+ minutes) |

### Job Lifecycle

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
│ waiting  │───▶│  active  │───▶│completed │    │  failed   │
└──────────┘    └────┬─────┘    └──────────┘    └───────────┘
                     │                               ▲
                     │         ┌──────────┐          │
                     └────────▶│ delayed  │──────────┘
                               │ (retry)  │
                               └──────────┘
```

## WebSocket Notifications

### Connection

```javascript
// Connect with JWT token
const ws = new WebSocket('wss://api.example.com/api/ws?token=<jwt>');

ws.onopen = () => {
  // Subscribe to conversation
  ws.send(JSON.stringify({
    action: 'subscribe',
    conversationId: '<conversation-id>'
  }));
};
```

### Notification Types

| Type | Description | Payload |
|------|-------------|---------|
| `job:started` | Job processing began | `jobId`, `conversationId`, `messageId` |
| `job:progress` | Progress update | `progress: { stage, percent }` |
| `job:completed` | Job finished successfully | `jobId`, `messageId` |
| `job:failed` | Job failed | `jobId`, `messageId` |
| `message:updated` | Message content updated | `messageId` |
| `state:updated` | Conversation state updated | `stateId` |

### Example Notification

```json
{
  "type": "job:progress",
  "jobId": "123",
  "conversationId": "abc-def",
  "progress": {
    "stage": "literature_search",
    "percent": 45
  }
}
```

### Client Implementation

```javascript
ws.onmessage = async (event) => {
  const notification = JSON.parse(event.data);

  switch (notification.type) {
    case 'job:progress':
      updateProgressBar(notification.progress.percent);
      break;

    case 'job:completed':
      // Fetch the actual message content
      const response = await fetch(`/api/messages/${notification.messageId}`);
      const message = await response.json();
      displayMessage(message);
      break;

    case 'job:failed':
      showError('Processing failed');
      break;
  }
};
```

## Monitoring

### Bull Board Dashboard

Access the Bull Board admin UI at `/admin/queues` when queue mode is enabled.

Features:
- View queue status and job counts
- Inspect job data and results
- Retry failed jobs
- Pause/resume queues

### Health Check

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "jobQueue": {
    "enabled": true,
    "redis": "connected"
  }
}
```

### Queue Metrics

```bash
# Via Bull Board API
curl http://localhost:3000/admin/queues/api/queues
```

Returns:
```json
{
  "queues": [
    {
      "name": "chat",
      "counts": {
        "active": 2,
        "waiting": 5,
        "completed": 150,
        "failed": 3
      }
    },
    {
      "name": "deep-research",
      "counts": {
        "active": 1,
        "waiting": 0,
        "completed": 25,
        "failed": 1
      }
    }
  ]
}
```

## Scaling

### Horizontal Scaling

Add more worker instances to process jobs faster:

```bash
# Docker
docker compose up -d --scale worker=5

# Manual
USE_JOB_QUEUE=true bun run worker  # Terminal 1
USE_JOB_QUEUE=true bun run worker  # Terminal 2
USE_JOB_QUEUE=true bun run worker  # Terminal 3
```

### Concurrency Tuning

Adjust based on your infrastructure:

```bash
# High-CPU server (lots of parallel processing)
CHAT_QUEUE_CONCURRENCY=10
DEEP_RESEARCH_QUEUE_CONCURRENCY=5

# Low-memory server (fewer parallel jobs)
CHAT_QUEUE_CONCURRENCY=2
DEEP_RESEARCH_QUEUE_CONCURRENCY=1
```

### Redis Clustering

For high availability, use Redis Cluster or Redis Sentinel:

```bash
REDIS_URL=redis://sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
```

## Troubleshooting

### Jobs Stuck in "waiting"

**Cause**: No workers are running.

**Fix**: Start a worker process:
```bash
USE_JOB_QUEUE=true bun run worker
```

### Jobs Stuck in "active"

**Cause**: Worker crashed mid-job. BullMQ will eventually mark these as stalled.

**Fix**: Jobs auto-recover after `stalledInterval` (30 seconds default). Or manually retry via Bull Board.

### Redis Connection Errors

**Cause**: Redis not running or network issues.

**Fix**:
```bash
# Check Redis is running
redis-cli ping  # Should return PONG

# Check connection URL
echo $REDIS_URL
```

### Worker TDZ Errors

**Cause**: Bun worker processes have different module initialization.

**Fix**: Don't use module-level variables. See `CLAUDE.md` for patterns.

```typescript
// BAD
const config = process.env.MY_VAR;

// GOOD
export function getConfig() {
  return process.env.MY_VAR;
}
```

### High Memory Usage

**Cause**: Too many retained jobs or large payloads.

**Fix**: Adjust retention settings in `src/queue/queues.ts`:
```typescript
removeOnComplete: {
  age: 1800,   // 30 minutes instead of 1 hour
  count: 500,  // Keep fewer jobs
}
```

### Duplicate Job Processing

**Cause**: Network partition caused BullMQ to think job was stalled.

**Fix**: Increase `lockDuration` in worker options:
```typescript
const worker = new Worker('chat', processor, {
  lockDuration: 60000,  // 60 seconds instead of 30
});
```

## API Reference

### Enqueue a Job

Jobs are enqueued automatically by route handlers. For manual enqueue:

```typescript
import { getChatQueue } from './queue/queues';

const queue = getChatQueue();
const job = await queue.add('chat', {
  userId: 'user-123',
  conversationId: 'conv-456',
  messageId: 'msg-789',
  message: 'Hello',
  authMethod: 'jwt',
  requestedAt: new Date().toISOString(),
});

console.log('Job ID:', job.id);
```

### Get Job Status

```typescript
const job = await queue.getJob(jobId);

if (job) {
  console.log('State:', await job.getState());  // waiting, active, completed, failed
  console.log('Progress:', job.progress);
  console.log('Result:', job.returnvalue);
}
```

### Retry Failed Job

```typescript
const job = await queue.getJob(jobId);
await job.retry();
```

---

For more details, see the [BullMQ documentation](https://docs.bullmq.io/).
