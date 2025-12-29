---
sidebar_position: 3
title: Configuration
description: Environment variables and configuration options
---

# Configuration

BioAgents is configured through environment variables.

## Required Variables

### LLM API Keys

At least one LLM provider is required:

```bash
OPENAI_API_KEY=sk-...           # OpenAI API key
ANTHROPIC_API_KEY=sk-ant-...    # Anthropic API key
GOOGLE_API_KEY=...              # Google AI API key
OPENROUTER_API_KEY=...          # OpenRouter API key
```

### Database

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_FULL_URL=postgresql://...  # For migrations
```

## LLM Configuration

Configure which models to use for different agents:

```bash
# Reply generation
REPLY_LLM_PROVIDER=openai
REPLY_LLM_MODEL=gpt-4

# Hypothesis generation
HYP_LLM_PROVIDER=openai
HYP_LLM_MODEL=gpt-4

# Planning
PLANNING_LLM_PROVIDER=openai
PLANNING_LLM_MODEL=gpt-4

# Structured output
STRUCTURED_LLM_PROVIDER=openai
STRUCTURED_LLM_MODEL=gpt-4
```

## Embedding Configuration

```bash
EMBEDDING_PROVIDER=openai
TEXT_EMBEDDING_MODEL=text-embedding-3-large
```

## RAG Configuration

```bash
CHUNK_SIZE=2000
CHUNK_OVERLAP=200
VECTOR_SEARCH_LIMIT=20
RERANK_FINAL_LIMIT=5
USE_RERANKING=true
SIMILARITY_THRESHOLD=0.45
KNOWLEDGE_DOCS_PATH=docs
```

## Job Queue Configuration

```bash
USE_JOB_QUEUE=true              # Enable BullMQ job queue
REDIS_URL=redis://localhost:6379

# Concurrency settings
CHAT_QUEUE_CONCURRENCY=5
DEEP_RESEARCH_QUEUE_CONCURRENCY=3
FILE_PROCESS_CONCURRENCY=5

# Rate limiting
CHAT_RATE_LIMIT_PER_MINUTE=10
DEEP_RESEARCH_RATE_LIMIT_PER_5MIN=3
```

## Authentication

```bash
AUTH_MODE=none                  # none, password, or jwt
UI_PASSWORD=...                 # For password mode
BIOAGENTS_SECRET=...            # JWT secret
```

## Server Configuration

```bash
PORT=3000
HOST=0.0.0.0
NODE_ENV=development            # development or production
```

## Storage Configuration

For file uploads:

```bash
S3_BUCKET=your-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=...                 # Optional: For S3-compatible storage
```
