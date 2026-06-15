# BioAgents (Archived)

> [!IMPORTANT]
> This repository is archived and no longer maintained.
>
> The BIOS product however is very actively maintained. Use BIOS at [chat.bio.xyz](https://chat.bio.xyz) and visit the BIOS landing page at [ai.bio.xyz](https://ai.bio.xyz).
>
> This code remains available for historical reference only. Issues, pull requests, and feature requests are no longer actively monitored here.


An advanced AI agent framework for biological and scientific research. BioAgents provides powerful conversational AI capabilities with specialized knowledge in biology, life sciences, and scientific research methodologies.

## State-of-the-Art Analysis Agent

The BioAgents analysis agent achieves state-of-the-art performance on the BixBench benchmark, outperforming all existing solutions:

![BioAgents Analysis Benchmark Results](https://ai-bio-xyz-flame.vercel.app/blog/bixbench_oa.png)

| Evaluation Mode | Score |
|-----------------|-------|
| Open-Answer | **48.78%** |
| Multiple-Choice (with refusal) | **55.12%** |
| Multiple-Choice (without refusal) | **64.39%** |

These results outperform Kepler, GPT-5, and others across all evaluation modes.

**Learn more:**
- [Introducing BioAgents](http://ai.bio.xyz/blog/introducing-bios) - Detailed blog post about our literature and analysis agents
- [Scientific Paper (arXiv)](https://arxiv.org/abs/2601.12542) - Full technical details and methodology

## Configurable Research Agents

BioAgents allows you to choose your primary literature and analysis agents. While multiple backends are supported, **BIO** is the recommended default:

| Agent Type | Primary (BIO) | Alternative |
|------------|---------------|-------------|
| **Literature** | BioAgents Literature API - semantic search with LLM reranking | OpenScholar, Edison |
| **Analysis** | BioAgents Data Analysis - state-of-the-art benchmark performance | Edison |

Configure your preferred agents in `.env`:
```bash
PRIMARY_LITERATURE_AGENT=bio    # or openscholar, edison
PRIMARY_ANALYSIS_AGENT=bio      # or edison
```

## Setup

Check out [SETUP.md](documentation/docs/SETUP.md)

## Agent Backend

### Routes

The system operates through two main routes:

- **[/api/chat](src/routes/chat.ts)** - Agent-based chat for general research questions with automatic literature search
- **[/api/deep-research](src/routes/deep-research/)** - Deep research mode with iterative hypothesis-driven investigation

**Chat diagram**
<img width="880" height="141" alt="image" src="https://github.com/user-attachments/assets/21493a0a-4401-4bb5-b1e7-55f9ae5e6db4" />


**Deep research diagram**
<img width="1999" height="878" alt="image" src="https://github.com/user-attachments/assets/87afd02c-9476-45d0-8ac0-66ac8b590e35" />


Both routes use the same agent architecture but differ in their orchestration and iteration patterns.

### Agents

**Agents** are the core concept in this repository. Each agent is a self-contained, independent function that performs a specific task in the research workflow. Agents are designed to be modular and reusable across different routes and contexts.

#### Available Agents

1. **[File Upload Agent](src/agents/fileUpload/)** - Handles file parsing, storage, and automatic description generation
   - Supports PDF, Excel, CSV, MD, JSON, TXT files
   - Generates AI-powered descriptions for each dataset
   - Stores files in cloud storage with metadata

2. **[Planning Agent](src/agents/planning/)** - Creates research plans based on user questions
   - Analyzes available datasets and research context
   - Generates task sequences (LITERATURE or ANALYSIS)
   - Updates current research objectives

3. **[Literature Agent](src/agents/literature/)** - Searches and synthesizes scientific literature
   - **OPENSCHOLAR**: General scientific literature search with citations
   - **EDISON**: Edison AI literature search (deep research mode only)
   - **KNOWLEDGE**: Searches your custom knowledge base with semantic search and reranking
   - Returns synthesized findings with inline citations in format: `(claim)[DOI or URL]`

4. **[Analysis Agent](src/agents/analysis/)** - Performs data analysis on uploaded datasets
   - **EDISON**: Deep analysis via Edison AI agent with file upload to Edison storage
   - **BIO**: Basic analysis via BioAgents Data Analysis Agent
   - Uploads datasets to analysis service and retrieves results

5. **[Hypothesis Agent](src/agents/hypothesis/)** - Generates research hypotheses
   - Synthesizes findings from literature and analysis
   - Creates testable hypotheses with inline citations
   - Considers current research context and objectives

6. **[Reflection Agent](src/agents/reflection/)** - Reflects on research progress
   - Extracts key insights and discoveries
   - Updates research methodology
   - Maintains conversation-level understanding

7. **[Reply Agent](src/agents/reply/)** - Generates user-facing responses
   - **Deep Research Mode**: Includes current objective, next steps, and asks for feedback
   - **Chat Mode**: Concise answers without next steps
   - Preserves inline citations throughout

#### Adding New Agents

To add a new agent:

1. Create a folder in `src/agents/`
2. Implement the main agent function in `index.ts`
3. Add supporting logic in separate files within the folder
4. Export the agent function for use in routes
5. Shared utilities go in [src/utils](src/utils)

### State Management

State is separated into two types:

**Message State** (`State`):

- Ephemeral, tied to a single message
- Contains processing details for that message only
- Automatically cleared after processing
- Used for temporary data like raw file buffers

**Conversation State** (`ConversationState`):

- Persistent across the entire conversation
- Contains cumulative research data:
  - Uploaded datasets with descriptions
  - Current plan and completed tasks
  - Key insights and discoveries
  - Current hypothesis and methodology
  - Research objectives
- Stored in database and maintained across requests
- This is the primary state that drives the research workflow

### LLM Library

The [LLM library](src/llm) provides a unified interface for multiple LLM providers. It allows you to use any Anthropic/OpenAI/Google or OpenRouter LLM via the [same interface](src/llm/provider.ts). Examples of calling the LLM library can be found in all agents.

**Key Features:**

- Unified API across providers (Anthropic, OpenAI, Google, OpenRouter)
- Extended thinking support for Anthropic models
- System instruction support
- Streaming and non-streaming responses
- Examples in every agent implementation

### Literature Agent & Knowledge Base

The Literature Agent includes multiple search backends:

**OPENSCHOLAR (Optional):**

- General scientific literature search with high-quality citations
- Requires custom deployment and configuration
- Set `OPENSCHOLAR_API_URL` and `OPENSCHOLAR_API_KEY` to enable
- Paper: https://arxiv.org/abs/2411.14199
- Deployment: https://github.com/bio-xyz/bio-openscholar

**EDISON (Optional):**

- Edison AI literature search (deep research mode only)
- Requires custom deployment and configuration
- Set `EDISON_API_URL` and `EDISON_API_KEY` to enable
- Deployment: https://github.com/bio-xyz/bio-edison-api

**KNOWLEDGE (Customizable):**

- Vector database with semantic search ([embeddings](src/embeddings))
- Cohere reranker for improved results (requires `COHERE_API_KEY`)
- Document processing from [docs directory](docs)
- Documents are processed once per filename and stored in vector DB

**To add custom knowledge:**

1. Place documents in the `docs/` directory
   - Supported formats: PDF, Markdown (.md), DOCX, TXT
2. Documents are automatically processed on startup
3. Vector embeddings are generated and stored
4. Available to Literature Agent via KNOWLEDGE tasks

**Docker Deployment Note**: When deploying with Docker, agent-specific documentation in `docs/` and branding images in `client/public/images/` are persisted using Docker volumes. These directories are excluded from git (see `.gitignore`) but automatically mounted in your Docker containers via volume mounts defined in `docker-compose.yml`. This allows you to customize your agent with private documentation without committing it to the repository.

### Analysis Agent Configuration

The Analysis Agent supports two backends for data analysis:

**EDISON (Default):**

- Deep analysis via Edison AI agent
- Automatic file upload to Edison storage service
- Requires `EDISON_API_URL` and `EDISON_API_KEY`
- https://github.com/bio-xyz/bio-edison-api

**BIO (Alternative):**

- Basic analysis via BioAgents Data Analysis Agent
- Set `PRIMARY_ANALYSIS_AGENT=bio` in `.env`
- Requires `DATA_ANALYSIS_API_URL` and `DATA_ANALYSIS_API_KEY`
- https://github.com/bio-xyz/bio-data-analysis

Both backends receive datasets and analysis objectives, execute analysis code, and return results.

### Character File

The [character file](src/character.ts) defines your agent's identity and system instructions. It's now simplified to focus on core behavior:

- **name**: Your agent's name
- **system**: System prompt that guides agent behavior across all interactions

The character's system instruction is automatically included in LLM calls for planning, hypothesis generation, and replies, ensuring consistent behavior throughout the research workflow. You can enable the system prompt in any LLM call by setting the 'systemInstruction' parameter.

## UI

**Component system:**

- Custom hooks in `client/src/hooks/`
- UI components in `client/src/components/ui/`
- Lucide icons via `client/src/components/icons/`

**Styling:**

- Main styles: `client/src/styles/global.css`
- Button styles: `client/src/styles/buttons.css`
- Mobile-first responsive design

## Authentication

BioAgents supports JWT authentication for external frontends:

| Setting | Options | Purpose |
| ------- | ------- | ------- |
| `AUTH_MODE` | `none` / `jwt` | JWT authentication for external frontends |

### JWT Authentication (Production)

For external frontends connecting to the API:

```bash
# .env
AUTH_MODE=jwt
BIOAGENTS_SECRET=your-secure-secret  # Generate with: openssl rand -hex 32
```

Your backend signs JWTs with the shared secret:

```javascript
// Your backend generates JWT for authenticated users
const jwt = await new jose.SignJWT({ sub: userId })  // sub must be valid UUID
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.BIOAGENTS_SECRET));

// Call BioAgents API
fetch('https://your-bioagents-api/api/chat', {
  headers: { 'Authorization': `Bearer ${jwt}` },
  body: JSON.stringify({ message: 'What is rapamycin?' })
});
```

**See [AUTH.md](documentation/docs/AUTH.md) for complete JWT integration guide**

## Job Queue (Production)

BioAgents supports BullMQ for reliable background job processing with:

- **Horizontal scaling**: Run multiple worker instances
- **Job persistence**: Jobs survive server restarts
- **Automatic retries**: Failed jobs retry with exponential backoff
- **Real-time updates**: WebSocket notifications for job progress
- **Admin dashboard**: Bull Board UI at `/admin/queues`

```bash
# Enable job queue
USE_JOB_QUEUE=true
REDIS_URL=redis://localhost:6379

# Start API server and worker separately
bun run dev      # API server
bun run worker   # Worker process
```

**📖 See [JOB_QUEUE.md](documentation/docs/JOB_QUEUE.md) for complete setup and configuration guide**

## Project Structure

```
├── src/                      # Backend source
│   ├── index.ts             # API server entry point
│   ├── worker.ts            # BullMQ worker entry point
│   ├── routes/              # HTTP route handlers
│   │   ├── chat.ts          # Agent-based chat endpoint
│   │   ├── deep-research/   # Deep research endpoints
│   │   └── admin/           # Bull Board dashboard
│   ├── agents/              # Independent agent modules
│   │   ├── fileUpload/      # File parsing & storage
│   │   ├── planning/        # Research planning
│   │   ├── literature/      # Literature search (OPENSCHOLAR, EDISON, KNOWLEDGE)
│   │   ├── analysis/        # Data analysis (EDISON, BIO)
│   │   ├── hypothesis/      # Hypothesis generation
│   │   ├── reflection/      # Research reflection
│   │   └── reply/           # User-facing responses
│   ├── services/            # Business logic layer
│   │   ├── chat/            # Chat-related services
│   │   ├── queue/           # BullMQ job queue system
│   │   │   ├── connection.ts    # Redis connection management
│   │   │   ├── queues.ts        # Queue definitions & config
│   │   │   ├── workers/         # Job processors
│   │   │   └── notify.ts        # Pub/Sub notifications
│   │   ├── websocket/       # Real-time notifications
│   │   │   ├── handler.ts       # WebSocket endpoint
│   │   │   └── subscribe.ts     # Redis Pub/Sub subscriber
│   │   └── jwt.ts           # JWT verification service
│   ├── middleware/          # Request/response middleware
│   │   ├── authResolver.ts  # Multi-method authentication
│   │   └── rateLimiter.ts   # Rate limiting
│   ├── llm/                 # LLM providers & interfaces
│   ├── embeddings/          # Vector database & document processing
│   ├── db/                  # Database operations
│   ├── storage/             # File storage (S3-compatible)
│   ├── utils/               # Shared utilities
│   ├── types/               # TypeScript types
│   └── character.ts         # Agent identity & system prompt
├── client/                  # Frontend UI (Preact)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # Custom hooks (chat, etc.)
│   │   └── styles/         # CSS files
│   └── public/             # Static assets
├── documentation/           # Project documentation
│   └── docs/               # Detailed guides (AUTH.md, SETUP.md, JOB_QUEUE.md)
├── docs/                    # Custom knowledge base documents (scientific papers)
└── package.json
```

---

Built with [Bun](https://bun.com) - A fast all-in-one JavaScript runtime.
