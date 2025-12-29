---
slug: /
sidebar_position: 1
title: Introduction
description: Welcome to BioAgents - AI-powered research agents for biological sciences
---

# Introduction

BioAgents is an AI-powered research platform designed for biological sciences. It combines multiple AI agents to help researchers conduct literature reviews, analyze datasets, and generate hypotheses.

## What is BioAgents?

BioAgents provides:

- **Deep Research** - Automated literature search and synthesis across multiple sources
- **File Analysis** - Upload and analyze biological datasets with AI assistance
- **Hypothesis Generation** - AI-driven hypothesis formulation based on research findings
- **Knowledge Base** - Custom RAG-powered knowledge retrieval

## Key Features

### Multi-Agent Architecture

BioAgents uses specialized AI agents for different tasks:

| Agent | Purpose |
|-------|---------|
| Planning Agent | Creates research plans and task breakdown |
| Literature Agent | Searches OpenScholar, Edison, and knowledge bases |
| Analysis Agent | Processes uploaded datasets |
| Hypothesis Agent | Generates research hypotheses |
| Reflection Agent | Synthesizes findings and updates world state |
| Reply Agent | Generates user-facing responses |

### Scalable Infrastructure

- **BullMQ Job Queue** - Reliable background processing for long-running tasks
- **Redis** - State management and pub/sub notifications
- **WebSocket** - Real-time progress updates
- **S3-Compatible Storage** - File upload and storage

## Quick Start

```bash
# Clone the repository
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents

# Install dependencies
bun install

# Configure environment
cp .env.example .env

# Start development server
bun run dev
```

## Next Steps

- [Installation Guide](/getting-started/installation) - Detailed setup instructions
- [Configuration](/getting-started/configuration) - Environment variables and options
- [Authentication](/guides/authentication) - Set up authentication
