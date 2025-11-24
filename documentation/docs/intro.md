---
title: Introduction
sidebar_label: Introduction
sidebar_position: 1
slug: /
---

# BioAgents AgentKit

An advanced AI agent framework for biological and scientific research. BioAgents provides powerful conversational AI capabilities with specialized knowledge in biology, life sciences, and scientific research methodologies.

## What is BioAgents?

BioAgents AgentKit is a comprehensive framework that combines state-of-the-art language models with specialized scientific tools to create intelligent research assistants. Built with [Bun](https://bun.sh), it offers a fast, efficient, and extensible platform for developing AI-powered scientific applications.

## Key Features

### 🧠 **Intelligent Agent System**
- **Multi-LLM Support**: Compatible with OpenAI, Anthropic, Google, and OpenRouter models
- **Tool-Based Architecture**: Modular system with planning, hypothesis generation, knowledge retrieval, and more
- **Context-Aware Responses**: Maintains conversation state and scientific context

### 🔬 **Scientific Research Tools**
- **Deep Research**: Comprehensive multi-source research on scientific topics
- **Semantic Scholar Integration**: Direct access to millions of scientific papers
- **Hypothesis Generation**: AI-powered scientific hypothesis creation
- **Code Execution**: Run Python data analysis in isolated sandboxes

### 📚 **Knowledge Management**
- **Vector Database**: Powered by pgvector for semantic search
- **Document Processing**: Automatic extraction and indexing of scientific documents
- **RAG (Retrieval Augmented Generation)**: Context-aware responses with source citations
- **Cohere Reranking**: Improved search relevance with AI reranking

### 💳 **x402 Payment Protocol**
- **USDC Micropayments**: Pay-per-request model on Base network
- **Three-Tier Access**: Privy JWT bypass, CDP wallet auth, or direct payment
- **Gasless Transfers**: EIP-3009 for fee-free payments
- **Embedded Wallets**: Email-based wallet creation via Coinbase

### 🎨 **Modern Web Interface**
- **React-Based UI**: Clean, responsive interface with dark mode
- **Real-Time Streaming**: Server-sent events for live responses
- **File Upload Support**: Process PDFs, CSVs, and scientific documents
- **Payment Integration**: Seamless USDC payment flow

## Architecture Overview

BioAgents follows a clean, modular architecture:

```
┌─────────────────────────────────────────────────┐
│                  Client UI                       │
│         (React, Hooks, SSE Streaming)           │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│              API Layer (Bun)                    │
│  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Routes    │  │    Middleware           │  │
│  │  - /chat    │  │  - Authentication       │  │
│  │  - /auth    │  │  - x402 Payments        │  │
│  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│              Tools System                       │
│  • Planning  • Reply  • Knowledge               │
│  • Hypothesis • Semantic Scholar                │
│  • Deep Research • Code Execution               │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         LLM Providers & Embeddings              │
│  OpenAI | Anthropic | Google | OpenRouter       │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│            Data Layer                           │
│  PostgreSQL + pgvector | Supabase (optional)    │
└─────────────────────────────────────────────────┘
```

## Core Concepts

### Tools
Tools are the fundamental building blocks of BioAgents. Each tool encapsulates specific functionality:
- **Planning Tool**: Strategic task decomposition
- **Reply Tool**: Context-aware response generation
- **Knowledge Tool**: Vector database search and retrieval
- **Hypothesis Tool**: Scientific hypothesis generation
- **Semantic Scholar**: Paper search and analysis
- **File Upload**: Document processing and extraction

### State Management
The framework maintains rich state throughout conversations:
- **Message State**: Citations, knowledge used, files processed
- **Conversation State**: Long-term conversation context (coming soon)
- **Tool Results**: Cached results for efficiency

### Character System
Customize your agent's personality and behavior through the character file:
- Define system prompts and instructions
- Set response templates for different contexts
- Configure tool preferences and behavior

### LLM Abstraction
Unified interface for multiple LLM providers:
- Consistent API across providers
- Easy provider switching
- Model-specific optimizations
- Support for Anthropic skills

## Quick Start

Get up and running in minutes:

1. **Install Dependencies**
   ```bash
   bun install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Add your API keys
   ```

3. **Run the Server**
   ```bash
   bun run dev
   ```

4. **Open the UI**
   ```
   http://localhost:3000
   ```

For detailed setup instructions, see [Installation](./getting-started/installation).

## Use Cases

BioAgents is designed for:

- **Research Scientists**: Literature review, hypothesis generation, data analysis
- **Biotechnology Companies**: Knowledge management, research automation
- **Academic Institutions**: Teaching assistant, research support
- **Pharmaceutical Research**: Drug discovery support, paper analysis
- **Data Scientists**: Scientific data analysis and visualization
- **AI Researchers**: Building domain-specific AI agents

## Project Structure

```
├── src/                      # Backend source
│   ├── routes/              # HTTP route handlers
│   │   └── chat.ts          # Main chat endpoint
│   ├── services/            # Business logic layer
│   │   └── chat/            # Chat-related services
│   ├── middleware/          # Request/response middleware
│   │   ├── smartAuth.ts     # Multi-method authentication
│   │   └── x402.ts          # Payment enforcement
│   ├── tools/               # Agent tools
│   ├── llm/                 # LLM providers & interfaces
│   ├── db/                  # Database operations
│   ├── x402/                # x402 payment protocol
│   └── embeddings/          # Vector DB & document processing
├── client/                  # Frontend UI
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom hooks
│   │   └── styles/         # CSS files
│   └── public/             # Static assets
└── documentation/           # This documentation site
```

## Project Philosophy

BioAgents is built on three core principles:

1. **Modularity**: Tools and components are independent and composable
2. **Extensibility**: Easy to add new tools, LLM providers, and features
3. **Performance**: Built with Bun for maximum speed and efficiency

## Docker Deployment

BioAgents includes Docker support for easy deployment:

- **Agent-Specific Documentation**: Place custom docs in `docs/` (persisted via volumes)
- **Custom Branding**: Add images to `client/public/images/` (persisted via volumes)
- **Automatic Processing**: Documents are indexed on startup
- **Volume Persistence**: Data persists across container restarts

These directories are git-ignored but automatically mounted in Docker containers, allowing you to customize your agent with private documentation without committing it to the repository.

## Next Steps

Ready to dive in?

- 📦 [**Installation Guide**](./getting-started/installation) - Set up your development environment
- 🚀 [**Quick Start**](./getting-started/quick-start) - Get your first agent running
- 🛠️ [**Agent Framework**](./backend/architecture) - Understand the architecture
- 🔬 [**Deep Research**](./deep-research/introduction) - Learn about advanced research capabilities
- 💻 [**API Reference**](./api-reference/overview) - Explore the API and test endpoints

## Community & Support

- **GitHub**: [bio-xyz/BioAgents](https://github.com/bio-xyz/BioAgents)
- **Issues**: Report bugs and request features
- **Discussions**: Share ideas and get help

---

Built with ❤️ using [Bun](https://bun.sh) - A fast all-in-one JavaScript runtime.
