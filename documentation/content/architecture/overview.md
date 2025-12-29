---
sidebar_position: 1
title: Architecture Overview
description: System architecture and component design
---

# Architecture Overview

BioAgents is built on a multi-agent architecture with scalable infrastructure.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                                │
│                   (Web UI / API Client)                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Server                              │
│                   (Elysia + Bun)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Routes    │  │  Middleware │  │  WebSocket  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────┐    ┌─────────────────────┐
│       Redis         │    │      Supabase       │
│   (Job Queue +      │    │    (PostgreSQL +    │
│    Pub/Sub)         │    │     Storage)        │
└──────────┬──────────┘    └─────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Worker Process                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Chat Worker  │  │Deep Research │  │ File Process │      │
│  │              │  │   Worker     │  │   Worker     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Agent Architecture

### Deep Research Flow

```
User Message
     │
     ▼
┌─────────────┐
│  Planning   │ ──▶ Creates task plan
│   Agent     │
└─────────────┘
     │
     ▼
┌─────────────┐     ┌─────────────┐
│ Literature  │     │  Analysis   │
│   Agent     │     │   Agent     │  ──▶ Parallel execution
└─────────────┘     └─────────────┘
     │                    │
     └────────┬───────────┘
              ▼
┌─────────────────────────┐
│    Hypothesis Agent     │ ──▶ Generate hypothesis
└─────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│    Reflection Agent     │ ──▶ Update world state
└─────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│      Reply Agent        │ ──▶ Generate response
└─────────────────────────┘
```

## Job Queue Architecture

BullMQ provides reliable job processing:

- **Chat Queue** - Standard chat messages (1-2 min)
- **Deep Research Queue** - Long-running research (20-30 min)
- **File Process Queue** - File uploads (10-60 sec)

### Job Recovery

Jobs survive restarts:
- Redis persistence with AOF
- Stalled job detection (1 minute)
- Automatic retry with exponential backoff
