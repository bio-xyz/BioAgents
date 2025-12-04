## Quick Start

### Prerequisites

- [bun](https://bun.sh/docs/installation) (required package manager)
- Node.js v23.3.0
- PostgreSQL database (we recommend Supabase for easy setup)

### 1. Install Dependencies

```bash
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and configure the following:

#### Required: Core Configuration

**Authentication:**
```bash
BIOAGENTS_SECRET=your-secure-random-string-here
```
Generate a secure random string for API authentication.

**LLM Providers:**
Configure which LLM provider to use for each agent:
```bash
# Choose provider for each agent
REPLY_LLM_PROVIDER=openai          # or google, anthropic, openrouter
REPLY_LLM_MODEL=gpt-4o

HYP_LLM_PROVIDER=openai
HYP_LLM_MODEL=gpt-4o

PLANNING_LLM_PROVIDER=openai
PLANNING_LLM_MODEL=gpt-4o

STRUCTURED_LLM_PROVIDER=openai
STRUCTURED_LLM_MODEL=gpt-4o

# Add API keys for your chosen providers
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...              # If using Google
ANTHROPIC_API_KEY=...           # If using Anthropic
OPENROUTER_API_KEY=...          # If using OpenRouter
```

**Database:**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```
Get these from your [Supabase project settings](https://supabase.com/dashboard).

### 3. Set up the Database

Run these SQL scripts in your PostgreSQL database:

1. **Core database schema:** [src/db/setup.sql](src/db/setup.sql)
   - Creates tables for users, conversations, messages, states
   - Sets up x402 payment tracking

2. **Embedding/vector support:** [src/embeddings/setup.sql](src/embeddings/setup.sql)
   - Enables pgvector extension
   - Creates vector storage for knowledge base

**Using Supabase SQL Editor:**
1. Go to your Supabase project → SQL Editor
2. Copy and paste each script
3. Run them in order

---

## Literature Agents Setup

Literature agents search and synthesize scientific literature. You can start with the basic KNOWLEDGE agent and add more advanced options later.

### KNOWLEDGE Agent (MVP - Easiest to Setup)

**Start here!** This is the easiest literature backend to set up and works with your own documents.

**Configuration:**
```bash
# Embedding provider for document vectorization
EMBEDDING_PROVIDER=openai
TEXT_EMBEDDING_MODEL=text-embedding-3-large

# Cohere reranker for better search results (optional but recommended)
COHERE_API_KEY=your-cohere-api-key
USE_RERANKING=true

# Vector search settings
VECTOR_SEARCH_LIMIT=20
RERANK_FINAL_LIMIT=5
SIMILARITY_THRESHOLD=0.45

# Document processing
KNOWLEDGE_DOCS_PATH=docs
CHUNK_SIZE=2000
CHUNK_OVERLAP=200
```

**Setup Steps:**
1. Get an OpenAI API key for embeddings (or use another embedding provider)
2. (Optional) Get a Cohere API key for reranking - improves results significantly
3. Place your knowledge base documents in the `docs/` directory
   - Supported formats: PDF, Markdown (.md), DOCX, TXT
4. Documents are automatically processed on server startup
5. Embeddings are stored in PostgreSQL with pgvector

**What you can do:** Search through your custom documentation, research papers, or domain-specific knowledge.

### OpenScholar Agent (Good Add-on)

Adds high-quality scientific literature search with peer-reviewed citations.

**Configuration:**
```bash
OPENSCHOLAR_API_URL=https://your-openscholar-deployment.com
OPENSCHOLAR_API_KEY=your-api-key
```

**Setup:**
1. Deploy OpenScholar: https://github.com/bio-xyz/bio-openscholar
2. Add API URL and key to `.env`

**What you gain:** Access to peer-reviewed scientific literature with proper citations.

**Research:** Based on https://arxiv.org/abs/2411.14199

### Edison Literature Agent (Amazing Add-on)

The most advanced literature search option with deep synthesis capabilities.

**Configuration:**
```bash
EDISON_API_URL=https://your-edison-deployment.com
EDISON_API_KEY=your-api-key
```

**Setup:**
1. Deploy Edison API: https://github.com/bio-xyz/bio-edison-api
2. Add API URL and key to `.env`

**What you gain:**
- Advanced literature synthesis
- Used in deep research mode for iterative investigation
- Best-in-class citation quality

---

## Analysis Agents Setup

⚠️ **Required for dataset processing:** You MUST configure at least one analysis agent (EDISON or BIO) to process uploaded datasets.

Both options are optional to configure, but if you want to upload and analyze datasets (CSV, Excel, etc.), you need one of them.

### Storage Setup (Required for Dataset Upload)

**Before configuring analysis agents, you need S3-compatible storage:**

```bash
STORAGE_PROVIDER=s3

# AWS S3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=your-bucket-name

# For S3-compatible services (DigitalOcean Spaces, MinIO, etc.)
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com  # Optional
```

**Setup Options:**

**Option 1: AWS S3**
1. Create an S3 bucket in AWS Console
2. Create IAM user with S3 access
3. Add credentials to `.env`

**Option 2: DigitalOcean Spaces**
1. Create a Space in DigitalOcean
2. Generate Spaces access key
3. Set `S3_ENDPOINT` to your region (e.g., `https://nyc3.digitaloceanspaces.com`)
4. Add credentials to `.env`

**Option 3: MinIO (Self-hosted)**
1. Deploy MinIO server
2. Create bucket
3. Set `S3_ENDPOINT` to your MinIO URL
4. Add credentials to `.env`

**Why you need this:** Uploaded datasets are stored in S3, then fetched and sent to analysis agents for processing.

### Edison Analysis Agent (Default)

The default analysis backend with advanced capabilities.

**Configuration:**
```bash
EDISON_API_URL=https://your-edison-deployment.com
EDISON_API_KEY=your-api-key
```

**Setup:**
1. Deploy Edison API: https://github.com/bio-xyz/bio-edison-api
2. Add API URL and key to `.env`
3. Edison is used by default (no `PRIMARY_ANALYSIS_AGENT` setting needed)

**What it does:**
- Deep analysis of uploaded datasets
- Automatic file upload to Edison storage
- Code execution in secure sandbox
- Returns detailed analysis results with visualizations

### BIO Data Analysis Agent (Alternative)

Alternative analysis backend if not using Edison.

**Configuration:**
```bash
PRIMARY_ANALYSIS_AGENT=bio
DATA_ANALYSIS_API_URL=https://your-bio-analysis-deployment.com
DATA_ANALYSIS_API_KEY=your-api-key
```

**Setup:**
1. Deploy BIO analysis agent: https://github.com/bio-xyz/bio-data-analysis
2. Set `PRIMARY_ANALYSIS_AGENT=bio` in `.env`
3. Add API URL and key to `.env`

**What it does:**
- Basic data analysis capabilities
- Code execution in secure sandbox
- Returns analysis results

**Choose one:** You only need either Edison OR BIO for analysis - not both.

---

## Character Configuration

Your agent's personality and behavior are defined in `src/character.ts`. This is a simple system prompt that guides how your agent responds.

**Configuration:**
```typescript
const character = {
  name: "YourAgentName",
  system: `Your system prompt here...`
};
```

**What to customize:**
- `name`: Your agent's name
- `system`: The system prompt that defines your agent's personality, expertise, and response style

The system prompt is automatically included in LLM calls for planning, hypothesis generation, and replies, ensuring consistent behavior throughout the research workflow.

**Example use cases:**
- Scientific research assistant with specific domain expertise
- Medical literature reviewer
- Data analysis expert
- Domain-specific research agent

---

### Development

**Run App:**

```bash
bun run dev
```

**Build UI only:**
You need to rebuild the UI after you make any changes to it.

```bash
bun run build:client
```

**Start production server (both UI and backend):**

```bash
bun start
```

The app will be available at `http://localhost:3000`

## UI Development

The client is built with Preact and uses Bun for bundling.

**Watch mode (auto-rebuild):**

```bash
bun run client/build.ts --watch
```
