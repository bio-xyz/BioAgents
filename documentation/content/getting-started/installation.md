---
sidebar_position: 2
title: Installation
description: How to install and set up BioAgents
---

# Installation

This guide covers the installation process for BioAgents.

## Prerequisites

- **Bun** v1.0+ or Node.js v18+
- **Docker** and Docker Compose (for production)
- **Redis** (included in Docker setup)
- **Supabase** account (for database)

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Required: LLM API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...

# Optional: Additional providers
GOOGLE_API_KEY=
OPENROUTER_API_KEY=
COHERE_API_KEY=
```

### 4. Database Setup

Run Supabase migrations:

```bash
bunx supabase db push --db-url "$SUPABASE_FULL_URL"
```

### 5. Start Development Server

```bash
bun run dev
```

The server will start at `http://localhost:3000`.

## Docker Production Setup

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env with production values
```

### 2. Start Services

```bash
docker compose up -d
```

This starts:
- **bioagents-api** - Main API server (port 3000)
- **bioagents-worker** - Background job processor
- **bioagents-redis** - Redis for job queue

### 3. Run Migrations

```bash
docker compose run --rm migrate
```

## Verify Installation

```bash
# Health check
curl http://localhost:3000/api/health

# Expected response
{"status":"ok","timestamp":"..."}
```

## Next Steps

- [Configuration](/getting-started/configuration) - Detailed configuration options
- [Authentication](/guides/authentication) - Set up authentication
- [Docker Deployment](/deployment/docker) - Production deployment
