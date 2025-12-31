---
sidebar_position: 4
title: Job Queue
description: Understanding async processing and monitoring jobs
---

# Job Queue

BioAgents uses BullMQ for reliable background job processing. Long-running tasks like deep research and file processing run asynchronously.

## Why Async Processing?

- **Deep research** takes 5-30 minutes
- **File analysis** can take 10-60 seconds
- HTTP requests would timeout
- Better resource utilization

## Queue Architecture

```
┌─────────────────────────────────────────────────┐
│                  API Server                      │
│                                                  │
│  POST /api/deep-research/start                  │
│         │                                        │
│         ▼                                        │
│  ┌─────────────┐                                │
│  │ Enqueue Job │                                │
│  └─────────────┘                                │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│                    Redis                         │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │    Chat    │ │   Deep     │ │    File     │ │
│  │   Queue    │ │  Research  │ │   Process   │ │
│  │            │ │   Queue    │ │   Queue     │ │
│  └────────────┘ └────────────┘ └─────────────┘ │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│                 Worker Process                   │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │   Chat     │ │   Deep     │ │    File     │ │
│  │  Worker    │ │  Research  │ │   Process   │ │
│  │            │ │   Worker   │ │   Worker    │ │
│  └────────────┘ └────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────┘
```

## Job Types

| Queue | Purpose | Typical Duration |
|-------|---------|------------------|
| `chat` | Standard chat messages | 1-2 minutes |
| `deep-research` | Comprehensive research | 5-30 minutes |
| `file-process` | File upload processing | 10-60 seconds |

## Job Lifecycle

```
┌──────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│  queued  │ → │  active   │ → │ completed │    │  failed   │
└──────────┘    └───────────┘    └───────────┘    └───────────┘
                     │                                  ▲
                     └──────── retry on error ─────────┘
```

### Status Values

| Status | Description |
|--------|-------------|
| `queued` | Waiting to be processed |
| `active` | Currently being processed |
| `completed` | Finished successfully |
| `failed` | Failed after all retries |
| `stalled` | Worker died mid-processing |

## Retry Configuration

Jobs automatically retry on failure:

| Queue | Attempts | Backoff |
|-------|----------|---------|
| Chat | 2 | Exponential (5s, 10s) |
| Deep Research | 2 | Exponential (5s, 10s) |
| File Process | 3 | Exponential (5s, 10s, 20s) |

## Monitoring Jobs

### Check Job Status

```bash
curl "https://api.bioagents.xyz/api/deep-research/status/{messageId}" \
  -H "Authorization: Bearer <token>"
```

### Bull Dashboard

Access the visual dashboard at:

```
http://localhost:3000/admin/queues
```

Features:
- View all queues and job counts
- Inspect individual jobs
- Retry failed jobs
- Clean completed jobs

## Job Recovery

### After Server Restart

Jobs persist in Redis and survive restarts:

1. **Queued jobs** - Picked up immediately
2. **Active jobs** - Become stalled, then re-queued
3. **Failed jobs** - Remain for 24 hours (can retry)

### Stalled Job Detection

Workers detect stalled jobs every 60 seconds:

```
Job active when worker dies
         │
         ▼
    Becomes stalled
         │
         ▼ (60 seconds)
    Moved back to queue
         │
         ▼
    Retried by another worker
```

## Concurrency Settings

Configure via environment variables:

```bash
# Number of concurrent jobs per worker
CHAT_QUEUE_CONCURRENCY=5
DEEP_RESEARCH_QUEUE_CONCURRENCY=3
FILE_PROCESS_CONCURRENCY=5
```

## Rate Limiting

Prevent overload with rate limits:

```bash
# Requests per time window
CHAT_RATE_LIMIT_PER_MINUTE=10
DEEP_RESEARCH_RATE_LIMIT_PER_5MIN=3
```

## Scaling Workers

Scale horizontally by running multiple worker instances:

```bash
# Docker Compose
docker compose up -d --scale worker=3
```

Each worker processes jobs from all queues based on concurrency settings.

## Job Data Structure

### Deep Research Job

```json
{
  "id": "msg_xyz789",
  "name": "deep-research-msg_xyz789",
  "data": {
    "userId": "user_001",
    "conversationId": "conv_123456",
    "messageId": "msg_xyz789",
    "message": "Research query...",
    "stateId": "state_abc",
    "conversationStateId": "cs_def",
    "requestedAt": "2025-12-18T10:00:00Z"
  },
  "opts": {
    "attempts": 2,
    "backoff": {
      "type": "exponential",
      "delay": 5000
    }
  }
}
```

## Notifications

Jobs emit events via Redis Pub/Sub:

| Event | Description |
|-------|-------------|
| `job:progress` | Task completed within job |
| `job:completed` | Job finished successfully |
| `job:failed` | Job failed |

Subscribe via WebSocket to receive these in real-time.
