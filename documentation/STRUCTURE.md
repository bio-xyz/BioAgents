# Documentation Structure

This document outlines the organizational structure of the BioAgents documentation.

**Official Repository:** [https://github.com/bio-xyz/BioAgents](https://github.com/bio-xyz/BioAgents)

## Overview

The documentation is organized into 9 main sections, each focusing on a specific aspect of the framework.

## Documentation Sections

### 1. Introduction (`intro.md`)
- Overview
- Key Features
- Use Cases

### 2. Getting Started (`/getting-started`)
- **Installation** - Prerequisites, local setup, environment variables, database setup
- **Quick Start** - Running the application, first conversation, testing

### 3. Core Concepts (`/core-concepts`)
- **Architecture Overview** - System architecture, request flow, component interaction
- **State Management** - Message state, conversation state, lifecycle
- **Character System** - Character definition, system prompts, response templates

### 4. Backend Development (`/backend`)
- **Routes** - Chat route, deep research route, authentication routes, x402 routes
- **Tools** (`/backend/tools`)
  - Overview - What are tools, architecture, enabling/disabling, creating custom tools
  - Planning Tool
  - Knowledge Tool - Vector database, document processing, reranking
  - Hypothesis Tool
  - File Upload Tool
  - Semantic Scholar Tool
  - Reply Tool
- **LLM Library** - Unified interface, supported providers (Anthropic, OpenAI, Google, OpenRouter), skills
- **Embeddings & Vector Search** - Vector database, embedding providers, document processing
- **Middleware** - Smart authentication, x402 payment enforcement

### 5. Frontend Development (`/frontend`)
- **Overview** - Technology stack, project structure, build system
- **Components** - Core components (ChatInput, Message, Header, Sidebar), UI components, icons
- **Custom Hooks** - useAuth, useChatAPI, useEmbeddedWallet, useFileUpload, useSessions, useToast, useX402Payment
- **Styling** - CSS architecture, global styles, button styles, responsive design, theme system

### 6. x402 Payment System (`/x402-payments`)
- **Overview** - What is x402, three-tier access control, payment flow, gasless transfers
- **Setup & Configuration** - Testnet setup, mainnet setup, CDP credentials, environment variables
- **Embedded Wallets** - Coinbase embedded wallets, email-based authentication, wallet management
- **Pricing Configuration** - Route-based pricing, default pricing, custom rules
- **Authentication Methods** - Privy JWT, CDP wallet, external agent access

### 7. API Reference (`/api-reference`)
- **Chat Endpoint** - POST /api/chat with request/response examples
- **Deep Research** - Start and status endpoints
- **Authentication Endpoints** - Authentication flow, token management, wallet connection
- **x402 Payment Endpoints** - Payment verification, transaction status, balance queries

### 8. Deployment (`/deployment`)
- **Docker Deployment** - Building images, Docker Compose, volume management, environment configuration
- **Production Deployment** - Infrastructure requirements, security considerations, monitoring, scaling
- **Database Setup** - PostgreSQL configuration, migrations, backups, performance optimization

### 9. Guides (`/guides`)
- **Creating a Custom Tool** - Tool structure, implementation steps, testing, integration
- **Creating a Custom Character** - Character file structure, defining persona, response templates, best practices
- **Processing Documents** - Supported formats, document preparation, upload process, vector indexing
- **Integrating a New LLM Provider** - Adapter structure, implementation, testing, configuration

## File Structure

```
docs/
├── intro.md
├── getting-started/
│   ├── _category_.json
│   ├── installation.md
│   └── quick-start.md
├── core-concepts/
│   ├── _category_.json
│   ├── architecture.md
│   ├── character-system.md
│   └── state-management.md
├── backend/
│   ├── _category_.json
│   ├── routes.md
│   ├── tools/
│   │   ├── _category_.json
│   │   ├── overview.md
│   │   ├── planning-tool.md
│   │   ├── knowledge-tool.md
│   │   ├── hypothesis-tool.md
│   │   ├── file-upload-tool.md
│   │   ├── semantic-scholar.md
│   │   └── reply-tool.md
│   ├── llm-library.md
│   ├── embeddings.md
│   └── middleware.md
├── frontend/
│   ├── _category_.json
│   ├── overview.md
│   ├── components.md
│   ├── hooks.md
│   └── styling.md
├── x402-payments/
│   ├── _category_.json
│   ├── overview.md
│   ├── setup.md
│   ├── embedded-wallets.md
│   ├── pricing.md
│   └── authentication.md
├── api-reference/
│   ├── _category_.json
│   ├── chat-endpoint.md
│   ├── deep-research.md
│   ├── authentication.md
│   └── x402-endpoints.md
├── deployment/
│   ├── _category_.json
│   ├── docker.md
│   ├── production.md
│   └── database.md
└── guides/
    ├── _category_.json
    ├── creating-custom-tool.md
    ├── custom-character.md
    ├── processing-documents.md
    └── integrating-new-llm.md
```

## Notes

- All content sections currently contain only titles and subtitles (no content yet)
- The structure is designed to be comprehensive and cover all aspects of the BioAgents AgentKit framework
- The blog feature has been disabled in the configuration
- Sidebar is auto-generated from the folder structure

