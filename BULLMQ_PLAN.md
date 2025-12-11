# BullMQ Job Queue Implementation Plan

## Overview

Migrate `/api/chat` and `/api/deep-research` from in-process execution to BullMQ job queue for better scalability, reliability, and resource management.

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Elysia Server                         │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   /api/chat     │    │  /api/deep-research/start   │ │
│  │  (sync block)   │    │  (fire-and-forget async)    │ │
│  └────────┬────────┘    └──────────────┬──────────────┘ │
│           │                            │                 │
│           ▼                            ▼                 │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Main Event Loop                         ││
│  │  - LLM calls (planning, hypothesis, reply)          ││
│  │  - Literature search (OpenScholar, Edison, Knowledge)││
│  │  - Analysis (Edison/BIO)                            ││
│  │  - Database operations                               ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Problems:**
- Chat blocks request until completion (10-60s)
- Deep research runs in main process (memory accumulation)
- No job persistence (lost on restart)
- No retry mechanism
- No concurrency control
- No per-user rate limiting

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Elysia Server                         │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   /api/chat     │    │  /api/deep-research/start   │ │
│  │  (enqueue job)  │    │      (enqueue job)          │ │
│  └────────┬────────┘    └──────────────┬──────────────┘ │
│           │                            │                 │
│           ▼                            ▼                 │
│  ┌─────────────────────────────────────────────────────┐│
│  │                    BullMQ Queue                      ││
│  │            (backed by Redis)                         ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Worker Process(es)                    │
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │  Chat Worker    │    │   Deep Research Worker      │ │
│  │  concurrency: 5 │    │      concurrency: 3         │ │
│  └─────────────────┘    └─────────────────────────────┘ │
│                                                          │
│  - Job execution isolated from HTTP server              │
│  - Automatic retries with exponential backoff           │
│  - Progress tracking                                     │
│  - Rate limiting per user                               │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Infrastructure Setup

#### 1.1 Add Dependencies

```bash
bun add bullmq ioredis
```

#### 1.2 Redis Configuration

Add to `.env.example`:
```bash
# Redis for BullMQ job queue
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Job Queue Settings
CHAT_QUEUE_CONCURRENCY=5
DEEP_RESEARCH_QUEUE_CONCURRENCY=3
JOB_MAX_RETRIES=3
JOB_TIMEOUT_MS=600000  # 10 minutes
```

#### 1.3 Create Redis Connection

**File:** `src/queue/connection.ts`

```typescript
import { Redis } from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      connection = new Redis(redisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
      });
    } else {
      connection = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      });
    }

    connection.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }

  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
```

---

### Phase 2: Queue Definitions with Retry Configuration

#### 2.1 Queue Setup

**File:** `src/queue/queues.ts`

```typescript
import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

// Chat queue - for /api/chat requests
export const chatQueue = new Queue("chat", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    // RETRY CONFIGURATION
    attempts: 3,  // Retry up to 3 times on failure
    backoff: {
      type: "exponential",  // 1s, 2s, 4s delays
      delay: 1000,
    },
    // Job cleanup
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Deep research queue - for /api/deep-research requests
export const deepResearchQueue = new Queue("deep-research", {
  connection: getRedisConnection(),
  defaultJobOptions: {
    // RETRY CONFIGURATION (fewer retries for long jobs)
    attempts: 2,  // Retry up to 2 times
    backoff: {
      type: "exponential",  // 5s, 10s delays
      delay: 5000,
    },
    // Job cleanup
    removeOnComplete: {
      age: 86400, // Keep for 24 hours
      count: 500,
    },
    removeOnFail: {
      age: 604800, // Keep failed for 7 days
    },
  },
});
```

#### 2.2 Retry Behavior Summary

| Queue | Max Attempts | Backoff Type | Delays |
|-------|-------------|--------------|--------|
| Chat | 3 | Exponential | 1s → 2s → 4s |
| Deep Research | 2 | Exponential | 5s → 10s |

**When retries trigger:**
- LLM API timeout or error
- Database connection failure
- External service (OpenScholar, Edison) unavailable
- Any unhandled exception in job processor

**When retries DON'T trigger:**
- Job explicitly marked as non-retryable
- Max attempts exhausted (moves to "failed" state)

#### 2.3 Job Types

**File:** `src/queue/types.ts`

```typescript
export interface ChatJobData {
  // Request context
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;

  // Auth context
  authMethod: "jwt" | "x402" | "api_key" | "anonymous";
  externalId?: string; // Wallet address for x402

  // File references (can't serialize File objects)
  fileIds?: string[]; // References to already-uploaded files

  // Metadata
  source: "api" | "x402";
  requestedAt: string;
}

export interface DeepResearchJobData {
  // Same as ChatJobData
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;
  authMethod: "jwt" | "x402" | "api_key" | "anonymous";
  externalId?: string;
  fileIds?: string[];
  source: "api" | "x402";
  requestedAt: string;

  // Deep research specific
  stateId: string;
  conversationStateId: string;
}

export interface JobProgress {
  stage: string;
  percent: number;
  message?: string;
}

export interface ChatJobResult {
  text: string;
  userId: string;
  responseTime: number;
}

export interface DeepResearchJobResult {
  messageId: string;
  status: "completed" | "failed";
  responseTime: number;
}
```

---

### Phase 3: Workers with Retry Handling

#### 3.1 Chat Worker

**File:** `src/queue/workers/chat.worker.ts`

```typescript
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import type { ChatJobData, ChatJobResult, JobProgress } from "../types";
import logger from "../../utils/logger";

async function processChatJob(
  job: Job<ChatJobData, ChatJobResult>
): Promise<ChatJobResult> {
  const startTime = Date.now();
  const { userId, conversationId, messageId, message } = job.data;

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn({
      jobId: job.id,
      messageId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts,
    }, "chat_job_retry_attempt");
  }

  logger.info({ jobId: job.id, messageId }, "chat_job_started");

  try {
    // Update progress: Planning
    await job.updateProgress({ stage: "planning", percent: 10 } as JobProgress);

    // ... planning logic ...

    // Update progress: Literature
    await job.updateProgress({ stage: "literature", percent: 30 } as JobProgress);

    // ... literature logic ...

    // Update progress: Hypothesis
    await job.updateProgress({ stage: "hypothesis", percent: 60 } as JobProgress);

    // ... hypothesis logic ...

    // Update progress: Reply
    await job.updateProgress({ stage: "reply", percent: 90 } as JobProgress);

    // ... reply logic ...

    const responseTime = Date.now() - startTime;

    return {
      text: replyText,
      userId,
      responseTime,
    };
  } catch (error) {
    logger.error({
      jobId: job.id,
      error,
      attempt: job.attemptsMade + 1,
      willRetry: job.attemptsMade + 1 < (job.opts.attempts || 3),
    }, "chat_job_failed");

    // Re-throw to trigger retry (if attempts remaining)
    throw error;
  }
}

export function startChatWorker(): Worker {
  const concurrency = parseInt(process.env.CHAT_QUEUE_CONCURRENCY || "5");

  const worker = new Worker<ChatJobData, ChatJobResult>(
    "chat",
    processChatJob,
    {
      connection: getRedisConnection(),
      concurrency,
      limiter: {
        max: 10, // Max 10 jobs per user
        duration: 60000, // Per minute
        groupKey: "userId",
      },
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, responseTime: result.responseTime },
      "chat_job_completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
        willRetry: false, // This event fires after all retries exhausted
      },
      "chat_job_failed_permanently"
    );
  });

  return worker;
}
```

#### 3.2 Deep Research Worker

**File:** `src/queue/workers/deep-research.worker.ts`

```typescript
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import type { DeepResearchJobData, DeepResearchJobResult, JobProgress } from "../types";
import logger from "../../utils/logger";

async function processDeepResearchJob(
  job: Job<DeepResearchJobData, DeepResearchJobResult>
): Promise<DeepResearchJobResult> {
  const startTime = Date.now();
  const { messageId, conversationId, stateId } = job.data;

  // Log retry attempt if this is a retry
  if (job.attemptsMade > 0) {
    logger.warn({
      jobId: job.id,
      messageId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts,
    }, "deep_research_job_retry_attempt");
  }

  logger.info({ jobId: job.id, messageId }, "deep_research_job_started");

  try {
    // Planning phase
    await job.updateProgress({ stage: "planning", percent: 5 });

    // Literature phase
    await job.updateProgress({ stage: "literature", percent: 20 });

    // Analysis phase (if applicable)
    await job.updateProgress({ stage: "analysis", percent: 50 });

    // Hypothesis phase
    await job.updateProgress({ stage: "hypothesis", percent: 70 });

    // Reflection phase
    await job.updateProgress({ stage: "reflection", percent: 85 });

    // Reply phase
    await job.updateProgress({ stage: "reply", percent: 95 });

    const responseTime = Date.now() - startTime;

    return {
      messageId,
      status: "completed",
      responseTime,
    };
  } catch (error) {
    logger.error({
      jobId: job.id,
      error,
      attempt: job.attemptsMade + 1,
      willRetry: job.attemptsMade + 1 < (job.opts.attempts || 2),
    }, "deep_research_job_failed");

    // Only update state to failed if this is the last attempt
    if (job.attemptsMade + 1 >= (job.opts.attempts || 2)) {
      const { updateState } = await import("../../db/operations");
      await updateState(stateId, {
        error: error instanceof Error ? error.message : "Unknown error",
        status: "failed",
      });
    }

    throw error;
  }
}

export function startDeepResearchWorker(): Worker {
  const concurrency = parseInt(process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || "3");

  const worker = new Worker<DeepResearchJobData, DeepResearchJobResult>(
    "deep-research",
    processDeepResearchJob,
    {
      connection: getRedisConnection(),
      concurrency,
      limiter: {
        max: 3, // Max 3 jobs per user
        duration: 300000, // Per 5 minutes
        groupKey: "userId",
      },
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, messageId: result.messageId, responseTime: result.responseTime },
      "deep_research_job_completed"
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      },
      "deep_research_job_failed_permanently"
    );
  });

  return worker;
}
```

---

### Phase 4: Route Changes

#### 4.1 Chat Route (Async with Polling)

**File:** `src/routes/chat.ts` (modified)

```typescript
// Option A: Return job ID immediately, client polls for result
export async function chatHandler(ctx: any) {
  // ... validation and setup ...

  // Create message record first
  const messageResult = await createMessageRecord({ ... });

  // Enqueue job
  const job = await chatQueue.add(
    `chat-${messageResult.message.id}`,
    {
      userId,
      conversationId,
      messageId: messageResult.message.id,
      message,
      authMethod: auth?.method || "anonymous",
      source,
      requestedAt: new Date().toISOString(),
    },
    {
      jobId: messageResult.message.id, // Use message ID as job ID
      priority: auth?.method === "x402" ? 1 : 2, // x402 gets priority
    }
  );

  return {
    jobId: job.id,
    messageId: messageResult.message.id,
    conversationId,
    status: "queued",
    pollUrl: `/api/chat/status/${job.id}`,
  };
}

// New: Status endpoint
app.get("/api/chat/status/:jobId", async ({ params }) => {
  const job = await chatQueue.getJob(params.jobId);

  if (!job) {
    return { status: "not_found" };
  }

  const state = await job.getState();
  const progress = job.progress as JobProgress;

  if (state === "completed") {
    return {
      status: "completed",
      result: job.returnvalue,
    };
  }

  if (state === "failed") {
    return {
      status: "failed",
      error: job.failedReason,
      attemptsMade: job.attemptsMade,
    };
  }

  return {
    status: state,
    progress,
    attemptsMade: job.attemptsMade,
  };
});
```

#### 4.2 Alternative: Synchronous Wait (for backward compatibility)

```typescript
// Option B: Wait for job completion (with timeout)
export async function chatHandler(ctx: any) {
  // ... setup ...

  const job = await chatQueue.add(...);

  // Wait for completion with timeout
  const result = await job.waitUntilFinished(
    chatQueue.events,
    60000 // 60 second timeout
  );

  return {
    text: result.text,
    userId: result.userId,
  };
}
```

---

### Phase 5: Worker Startup

#### 5.1 Separate Worker Process

**File:** `src/worker.ts`

```typescript
import { startChatWorker } from "./queue/workers/chat.worker";
import { startDeepResearchWorker } from "./queue/workers/deep-research.worker";
import logger from "./utils/logger";

async function main() {
  logger.info("Starting BullMQ workers...");

  const chatWorker = startChatWorker();
  const deepResearchWorker = startDeepResearchWorker();

  logger.info({
    chatConcurrency: process.env.CHAT_QUEUE_CONCURRENCY || 5,
    deepResearchConcurrency: process.env.DEEP_RESEARCH_QUEUE_CONCURRENCY || 3,
  }, "Workers started");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down workers...");
    await chatWorker.close();
    await deepResearchWorker.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch(console.error);
```

#### 5.2 Package.json Scripts

```json
{
  "scripts": {
    "dev": "bun --hot src/index.ts",
    "worker": "bun src/worker.ts",
    "dev:all": "concurrently \"bun run dev\" \"bun run worker\"",
    "start": "bun src/index.ts",
    "start:worker": "bun src/worker.ts"
  }
}
```

---

### Phase 6: Docker Deployment

#### 6.1 Docker Compose Update

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy

  worker:
    build: .
    command: bun run worker
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy
    deploy:
      replicas: 2  # Run 2 worker instances

volumes:
  redis_data:
```

---

## File Structure

```
src/
├── queue/
│   ├── connection.ts      # Redis connection
│   ├── queues.ts          # Queue definitions with retry config
│   ├── types.ts           # Job types
│   └── workers/
│       ├── chat.worker.ts
│       └── deep-research.worker.ts
├── routes/
│   ├── chat.ts            # Modified to enqueue jobs
│   └── deep-research/
│       ├── start.ts       # Modified to enqueue jobs
│       └── status.ts      # Uses job status
├── worker.ts              # Worker entry point
└── index.ts               # API server (unchanged mostly)
```

---

## Migration Strategy (Permanent Dual Mode)

The system will **permanently support both modes** - developers can work without Redis locally, while production uses BullMQ for scalability.

### Step 1: Add Infrastructure (No Breaking Changes)
- Add Redis, BullMQ dependencies
- Create queue/worker files
- Workers run alongside existing code

### Step 2: Implement Dual Mode
- Add feature flag: `USE_JOB_QUEUE=true/false`
- When `false` (default): Use existing in-process execution (no Redis needed)
- When `true`: Enqueue to BullMQ (requires Redis)
- Test both modes thoroughly

### Step 3: Production Deployment
- Deploy Redis (Docker or managed service)
- Set `USE_JOB_QUEUE=true` in production
- Deploy worker process(es) alongside API

### Step 4: Scaling (Production Only)
- Deploy multiple worker instances
- Adjust concurrency based on load

**Note:** Dual mode is permanent. The in-process execution code is retained for development convenience.

---

## Environment Variables Summary

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Queue Concurrency
CHAT_QUEUE_CONCURRENCY=5
DEEP_RESEARCH_QUEUE_CONCURRENCY=3

# Rate Limits
CHAT_RATE_LIMIT_PER_USER=10      # per minute
DEEP_RESEARCH_RATE_LIMIT_PER_USER=3  # per 5 minutes

# Job Settings
JOB_MAX_RETRIES=3
JOB_TIMEOUT_CHAT_MS=120000       # 2 minutes
JOB_TIMEOUT_DEEP_RESEARCH_MS=600000  # 10 minutes

# Feature Flag (migration)
USE_JOB_QUEUE=false
```

---

## Retry Configuration Summary

| Setting | Chat Queue | Deep Research Queue |
|---------|------------|---------------------|
| Max Attempts | 3 | 2 |
| Backoff Type | Exponential | Exponential |
| Initial Delay | 1 second | 5 seconds |
| Retry Delays | 1s → 2s → 4s | 5s → 10s |
| Failed Job Retention | 24 hours | 7 days |

**Retry triggers:**
- Network timeouts (LLM APIs, external services)
- Database connection errors
- Transient failures
- Unhandled exceptions

**Non-retryable scenarios:**
- Validation errors (bad input)
- Auth failures
- Explicit `UnrecoverableError` thrown

---

## Benefits After Implementation

| Aspect | Before | After |
|--------|--------|-------|
| Request Blocking | Chat blocks 10-60s | Returns immediately |
| Job Persistence | Lost on restart | Persisted in Redis |
| Retries | None | Automatic with exponential backoff |
| Rate Limiting | None | Per-user limits |
| Concurrency Control | None | Configurable per queue |
| Scaling | Single process | Horizontal worker scaling |
| Memory Management | Accumulates in main process | Isolated per worker |

---

## Estimated Effort

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1 | 2-3 hours | Infrastructure setup |
| Phase 2 | 1-2 hours | Queue definitions |
| Phase 3 | 4-6 hours | Workers (main work) |
| Phase 4 | 2-3 hours | Route modifications |
| Phase 5 | 1 hour | Worker startup |
| Phase 6 | 1-2 hours | Docker updates |
| **Total** | **11-17 hours** | |

---

## Open Questions

1. **Chat Response Model**:
   - Option A: Return job ID, client polls (breaking change)
   - Option B: Wait for completion (backward compatible)
   - Recommendation: Start with Option B for backward compatibility

2. **File Handling**:
   - Files must be uploaded before job creation
   - Pass file IDs/URLs instead of File objects
   - May need separate file upload endpoint

3. **x402 Payments**:
   - Payment verification before job enqueue
   - Job priority for paid requests
   - Refund mechanism if job fails?

4. **Redis Deployment**:
   - Managed Redis (Railway, Upstash, AWS ElastiCache)?
   - Self-hosted in Docker?
   - Recommendation: Start with Docker, migrate to managed for production
