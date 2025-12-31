---
sidebar_position: 1
title: Docker Deployment
description: Deploy BioAgents with Docker Compose
---

# Docker Deployment

Deploy BioAgents using Docker Compose for production environments.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+
- 4GB+ RAM recommended

## Quick Start

```bash
# Clone repository
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents

# Configure environment
cp .env.example .env
# Edit .env with your API keys and settings

# Start services
docker compose up -d
```

## Services

The Docker Compose setup includes:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| bioagents | bioagents-api | 3000 | Main API server |
| worker | bioagents-worker | - | Background job processor |
| redis | bioagents-redis | 6379 | Job queue and state |

## Configuration

### Environment Variables

Key variables for Docker deployment:

```bash
# Required
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=eyJ...

# Job Queue (automatically set in Docker)
USE_JOB_QUEUE=true
REDIS_URL=redis://redis:6379
```

### Scaling Workers

Scale the worker service for higher throughput:

```bash
docker compose up -d --scale worker=3
```

### Resource Limits

Adjust in `docker-compose.yml`:

```yaml
services:
  bioagents:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G
```

## Monitoring

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f worker
```

### Bull Dashboard

Access the job queue dashboard:

```
http://localhost:3000/admin/queues
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

## Updating

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose up -d --build
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker compose logs bioagents
```

### Redis connection issues

Ensure Redis is healthy:
```bash
docker compose exec redis redis-cli ping
```

### Job queue not processing

Check worker status:
```bash
docker compose logs worker
```
