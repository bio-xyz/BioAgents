# Worker Deployment Guide

Deploy workers to any server to scale your job processing capacity. Workers automatically share the load via Redis queue.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                      ┌─────────────────┐                        │
│                      │  Upstash Redis  │                        │
│                      │   (shared)      │                        │
│                      └────────┬────────┘                        │
│                               │                                  │
│              ┌────────────────┼────────────────┐                │
│              │                │                │                 │
│              ▼                ▼                ▼                 │
│     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│     │  Server 1   │  │  Server 2   │  │  Server 3   │          │
│     │  Worker x2  │  │  Worker x2  │  │  Worker x2  │          │
│     └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                                  │
│     All workers pull jobs from same queue automatically         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start (Any Server)

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Clone Repository

```bash
git clone https://github.com/bio-xyz/bioagents-agentkit.git
cd bioagents-agentkit
```

### 3. Configure Environment

```bash
cp .env.worker.example .env
nano .env  # Edit with your credentials
```

**Required values:**
- `REDIS_URL` - Your Upstash or managed Redis URL
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anon key
- `OPENAI_API_KEY` or `GOOGLE_API_KEY` - At least one LLM key

### 4. Deploy Workers

```bash
# Using the deployment script
./scripts/deploy-worker.sh 2    # Start 2 workers

# Or manually with docker-compose
docker-compose -f docker-compose.worker.yml up -d --scale worker=2
```

## Commands

```bash
# Start workers
docker-compose -f docker-compose.worker.yml up -d --scale worker=2

# View logs
docker-compose -f docker-compose.worker.yml logs -f

# Scale up (more capacity)
docker-compose -f docker-compose.worker.yml up -d --scale worker=5

# Scale down (save resources)
docker-compose -f docker-compose.worker.yml up -d --scale worker=1

# Stop all workers
docker-compose -f docker-compose.worker.yml down

# Check status
docker-compose -f docker-compose.worker.yml ps

# Rebuild after code update
git pull
docker-compose -f docker-compose.worker.yml build
docker-compose -f docker-compose.worker.yml up -d --scale worker=2
```

## Scaling Guide

| Queue Depth | Recommended Workers |
|-------------|---------------------|
| 0-10 jobs   | 2 workers           |
| 10-30 jobs  | 4 workers           |
| 30-50 jobs  | 6 workers           |
| 50+ jobs    | 8+ workers          |

### Monitor Queue Depth

```bash
# Check waiting jobs (requires redis-cli)
redis-cli -u $REDIS_URL LLEN bull:deep-research:waiting
redis-cli -u $REDIS_URL LLEN bull:chat:waiting
```

## Multi-Server Setup

### Server A (Primary)
```bash
cd bioagents-agentkit
./scripts/deploy-worker.sh 2
```

### Server B (Additional capacity)
```bash
# Same setup process
git clone https://github.com/bio-xyz/bioagents-agentkit.git
cd bioagents-agentkit
cp .env.worker.example .env
# Copy same .env values from Server A
./scripts/deploy-worker.sh 2
```

### Server C (Burst capacity)
```bash
# Spin up temporarily during traffic spikes
# Same process, shut down when not needed
```

All workers automatically share the job queue - no additional configuration needed.

## Resource Requirements

| Workers | RAM    | CPU   | Recommended VPS      |
|---------|--------|-------|----------------------|
| 1-2     | 2 GB   | 1 CPU | $6/mo (Hetzner CX22) |
| 3-4     | 4 GB   | 2 CPU | $12/mo (DO Basic)    |
| 5-8     | 8 GB   | 4 CPU | $24/mo               |

## Troubleshooting

### Workers not processing jobs

1. Check Redis connection:
```bash
docker-compose -f docker-compose.worker.yml logs | grep -i redis
```

2. Verify environment:
```bash
docker-compose -f docker-compose.worker.yml exec worker env | grep REDIS
```

### High memory usage

Reduce concurrency in `.env`:
```bash
DEEP_RESEARCH_QUEUE_CONCURRENCY=2
CHAT_QUEUE_CONCURRENCY=3
```

### Workers crashing

Check logs for errors:
```bash
docker-compose -f docker-compose.worker.yml logs --tail 100
```

## Updates

When code is updated:

```bash
git pull
docker-compose -f docker-compose.worker.yml build --no-cache
docker-compose -f docker-compose.worker.yml up -d --scale worker=2
```
