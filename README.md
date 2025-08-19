# BioAgents

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/made%20with-bun-black" /></a>
  <img src="https://img.shields.io/badge/node-v23.3.0-brightgreen" />
</p>

An advanced AI agent framework for biological and scientific research. BioAgents provides powerful conversational AI capabilities with specialized knowledge in biology, life sciences, and scientific research methodologies.

## About BioAgents

BioAgents is an AI system designed to assist researchers, students, and professionals in the biological sciences. Built on the ElizaOS framework, it combines state-of-the-art language models with sophisticated knowledge management systems to provide expert-level assistance in scientific inquiry and research.

## 🚀 Quick Start

### Prerequisites

- [bun](https://bun.sh/docs/installation) (required package manager)
- Node.js v23.3.0

### Installation & Running

```bash
# Clone the repository
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents

# Install dependencies
bun install

# Build the project
bun run build

# Navigate to the project starter
cd packages/project-starter

# Start BioAgents
bun run ../cli/dist/index.js start
```

### Configuration

Create a `.env` file in the project-starter directory:

```bash
# Copy from template (in packages/project-starter directory)
cp .env.example .env
```

<details><summary>View All Environment Variables</summary>

```bash
# Database Configuration
POSTGRES_URL=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=

# LLM Keys
OPENAI_API_KEY= # For embeddings and OpenAI models
ANTHROPIC_API_KEY= # For Anthropic Claude models
OPENROUTER_API_KEY= # For accessing multiple LLMs through OpenRouter (recommended)

# OpenRouter Model Configuration
# Format: provider/model-name (e.g., "anthropic/claude-opus-4", "openai/gpt-4o", "google/gemini-2.5-flash")
OPENROUTER_LARGE_MODEL=anthropic/claude-opus-4
OPENROUTER_SMALL_MODEL=google/gemini-2.5-flash

# Model Configuration
EMBEDDING_PROVIDER=openai
TEXT_EMBEDDING_MODEL=text-embedding-3-large
TEXT_PROVIDER="openrouter" | "anthropic" | "openai"

# TEXT_MODEL Configuration (depends on TEXT_PROVIDER):
# For OpenRouter: Use full model paths like "anthropic/claude-opus-4", "openai/gpt-4o", "google/gemini-2.5-flash"
# For Anthropic: Use model IDs like "claude-opus-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022"
# For OpenAI: Use model names like "gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3"
TEXT_MODEL=anthropic/claude-opus-4

LARGE_MODEL=claude-opus-4-20250514
SMALL_MODEL=claude-3-5-haiku-20241022
ANTHROPIC_LARGE_MODEL=claude-opus-4-20250514

# Rate Limiting and Token Configuration (for the knowledge plugin)
MAX_CONCURRENT_REQUESTS=1
REQUESTS_PER_MINUTE=60
TOKENS_PER_MINUTE=150000
MAX_INPUT_TOKENS=2000
MAX_OUTPUT_TOKENS=2000

# Document Processing Configuration (for the knowledge plugin)
MAX_DOCUMENTS_TO_PROCESS=1
DOCUMENT_PROCESSING_BATCH_SIZE1=
CHUNK_SIZE=2000
CHUNK_OVERLAP=50
MAX_CHUNKS_PER_DOCUMENT=5
CHUNK_PROCESSING_DELAY_MS=2000

# For contextual knowledge used by the knowledge plugin
LOAD_DOCS_ON_STARTUP=false
CTX_KNOWLEDGE_ENABLED=true

# Knowledge Graph Configuration (for the knowledge graph plugin)
KG_TRIPLE_STORE_URL=
KG_GOOGLE_DRIVE_FOLDER_ID=
KG_GENERATION_MODEL=

# Google Cloud Configuration (for the load-kg script)
GCP_JSON_CREDENTIALS=

# Monitoring and Observability
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASEURL=https://cloud.langfuse.com

# Application Configuration

# Evaluation script Configuration
EVALUATE_OTHER_MODEL=false
EVALUATION_EXTERNAL_MODEL=
MODEL_TO_EVALUATE_WITH=openai/gpt-4o  # Model used for evaluation scripts

# Logging level
LOG_LEVEL=info
```

Other .env variables are explained in `packages/project-starter/.env.example`

</details>

## 🎯 Features

**Core Conversation:**

- 💬 Engage in detailed scientific discussions across various biological disciplines
- 🧬 Access comprehensive knowledge in science (depending on the docs you 'feed' the agent with)
- 🔬 Discuss research methodologies, experimental design, and data analysis
- 📚 Learn about biological concepts, pathways, and mechanisms

**Knowledge Access:**

- 📄 PDF document processing and analysis capabilities
- 🎥 Video understanding for multimedia content
- 🔍 Knowledge graph access for scientific paper details
- 🤖 Natural language interaction powered by modern AI models

**Infrastructure:**

- 🗣️ Voice synthesis with ElevenLabs integration
- 💾 SQL database integration for persistent memory
- 🤝 Discord integration for community engagement
- 📊 Real-time observability with Langfuse

## 📖 Usage

Once the AI is running, you can:

1. **Web Interface**: Access the chat interface at http://localhost:3000

## 🛠️ Development

This project is built on the ElizaOS framework. For development:

```bash
# After making changes, rebuild the project
bun run build

# Stop the server (Ctrl+C) and restart
cd packages/project-starter
bun run ../cli/dist/index.js start
```

**Note:** There is no hot reload currently. After making changes, you need to stop the server, rebuild, and restart.

## 📂 Project Structure

```
BioAgents/
├── packages/
│   ├── core/          # Core AI functionality
│   ├── cli/           # Command-line interface
│   ├── client/        # Web interface
│   └── project-starter/ # Main agent configuration
│       ├── .env       # Environment configuration
│       ├── scripts/
│       │   └── eval/  # Agent evaluation and load testing
│       └── src/
│           └── character.ts  # BioAgents AI personality and behavior, loaded from a GitHub gist
└── README.md          # This file
```

### AI Capabilities

The BioAgents agent incorporates multiple plugins for enhanced functionality:

- **Knowledge Plugin**: Access to scientific papers, research data, and biological knowledge
- **Knowledge Graph Plugin**: Advanced scientific research capabilities (see details below)
- **Twitter Integration**: Community engagement (requires Twitter tokens in .env)
- **Discord Integration**: Community engagement (requires Discord tokens in .env)
- **Voice Synthesis**: ElevenLabs integration for voice output
- **Document Processing**: PDF analysis and video understanding
- **Database**: PostgreSQL/PGLite for persistent memory

### Loading character file

Character file is loaded from a GitHub gist, using the AGENT_CONFIG_URL .env variable (e.g. https://gist.githubusercontent.com/mygithub/58391035180310931/raw).

To understand the character file structure, an example file is provided in the repository root: `exampleCharacter.json`. This file contains a complete example configuration with all plugins and templates properly set up.

### Knowledge Graph Plugin

The knowledge graph plugin (`packages/plugin-kg`) enables sophisticated scientific research capabilities:

**Key Features:**

- **Dynamic Query Planning**: AI-powered planning system that generates multi-step research strategies
- **SPARQL Integration**: Queries a triple store containing scientific papers, metadata, and ontology terms
- **Automatic Citation**: All responses include proper DOI citations for referenced papers
- **Multi-Step Analysis**: Supports complex research workflows with dependent queries

**Available Tools:**

- `CONCEPT_SEARCH`: Find papers related to specific biological concepts, pathways, or mechanisms
- `GET_AUTHOR_PAPERS_ON_CONCEPT`: Search for papers by specific authors on given topics
- `GET_ALL_DATA_FROM_PAPER`: Extract complete metadata from specific papers
- `HYPOTHESES_GENERATION`: Generate testable research hypotheses based on findings

**Configuration:**

```bash
# Knowledge Graph Configuration (required for research features)
KG_TRIPLE_STORE_URL=<your_sparql_endpoint>
KG_GENERATION_MODEL=gpt-4o  # Model for query generation
```

When users ask research questions, the plugin automatically:

1. Generates an execution plan
2. Creates and runs SPARQL queries
3. Processes and deduplicates results
4. Synthesizes findings into comprehensive responses
5. Includes all relevant paper citations

**Populating the Knowledge Graph:**

The knowledge graph needs to be populated with scientific data before it can be queried. BioAgents includes a script [load-kg.ts](packages/plugin-kg/src/scripts/load-kg.ts) to load JSON-LD formatted scientific papers into an Oxigraph triple store.

**Prerequisites:**

1. **Oxigraph Server**: Run an Oxigraph instance (default: http://localhost:7878)

   ```bash
   docker run -p 7878:7878 oxigraph/oxigraph
   ```

2. **Google Drive Setup**: Store your JSON-LD files in a Google Drive folder

   - Create a Google Cloud service account with Drive API access
   - Share your Drive folder with the service account email
   - Export the service account credentials as JSON

3. **Environment Variables**:
   ```bash
   # Required for knowledge graph population
   OXIGRAPH_URL=http://localhost:7878  # Your Oxigraph instance
   KG_GOOGLE_DRIVE_FOLDER_ID=<your_drive_folder_id>  # Google Drive folder containing JSON-LD files
   GCP_JSON_CREDENTIALS=<service_account_json>  # Google Cloud service account credentials
   ```

**Running the Population Script:**

```bash
# Navigate to the knowledge graph plugin directory
cd packages/plugin-kg

# Run the population script
bun run src/scripts/load-kg.ts
```

**How the Script Works:**

1. **Authentication**: Uses Google service account credentials to access Drive
2. **File Discovery**: Lists all JSON files in the specified Drive folder
3. **Duplicate Prevention**: Checks if each graph already exists in Oxigraph before downloading
4. **JSON-LD Processing**:
   - Downloads files from Google Drive
   - Parses JSON-LD using streaming parser
   - Converts to N-Quads format with proper graph URIs
5. **Storage**: Loads the quads into Oxigraph's triple store

**Data Format Requirements:**

Your JSON-LD files should follow standard scientific metadata schemas. Each file should represent a paper or dataset with:

- Proper @context definitions
- URIs for papers (typically DOIs)
- Author information
- Abstract and keywords
- Citations and references

**Example JSON-LD Structure:**

Your JSON-LD files should follow the scientific metadata schema defined in [`packages/plugin-kg/src/constants/constants.ts`](./packages/plugin-kg/src/constants/constants.ts). This schema is based on standard vocabularies such as [schema.org](https://schema.org/), [Dublin Core](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/), [FOAF](http://xmlns.com/foaf/0.1/), [BIBO](http://purl.org/ontology/bibo/), and others.

To convert your science papers from PDF format to this JSON LD format, it's highly recommended you use [BioAgents](https://github.com/bio-xyz/BioAgents-v1/tree/main) (v1). The guide for that is in the readme over there.

### Knowledge plugin

Handles internal knowledge, unpublished papers, emails, research, tweets, and both public and private knowledge (users can upload private docs only they can query). Uses a vector PostgreSQL database.

Docs are stored in the [/docs](./packages/project-starter/docs) folder and processed by the [document processor](./packages/plugin-knowledge/src/document-processor.ts) file by chunking them and storing in the aforementioned vector database.

### Plugin Selection Logic

The agent will choose on each reply whether to use knowledge plugin, knowledge graph plugin, or both. This is controlled by the messageHandlerTemplate in the character file.

### Twitter plugin

Twitter plugin allows people to interact with the agent via Twitter, where the agent can reply to them and engage in conversations. The behavior is very similar to how it behaves in the UI, the only exception being a different prompt for replying on Twitter "twitterReplyTemplate" in the character file.

Twitter plugin also allows your agent to post, by generating a random option (1, 2 or 3) and posting either a:

1. Hypothesis based on the science paper Knowledge Graph
2. Showcase of one of the science papers in the Knowledge Graph
3. News on a topic that the agent is interested in, using Perplexity.

## 🧪 Testing & Evaluation

BioAgents includes comprehensive evaluation and load testing capabilities:

### Agent Evaluation System

- **Dual-mode testing**: Compare your agent against external models (GPT-4, Claude, etc.)
- **8 scoring metrics**: Including completeness, relevance, safety, and character adherence
- **Fresh context**: Each question gets a new conversation to avoid contamination
- **CSV export**: Detailed results with averages and breakdowns

### Load Testing

- **Concurrent testing**: Simulate multiple users (default: 20) hitting the agent simultaneously
- **Performance metrics**: Response times, success rates, P95/P99 thresholds
- **Real-world simulation**: Uses actual questions from evaluation dataset

For detailed setup and usage instructions, see:

- [Evaluation README](packages/project-starter/scripts/eval/README.md) - Agent evaluation system
- [Load Test README](packages/project-starter/scripts/eval/load-test/README.md) - Concurrent load testing

### Optional authentication

Privy is used for authenticating via the custom BioAgents UI. You can disable this authentication in the [custom authentication file](packages/server/src/customAuth.ts). Auth is disabled when NODE_ENV is development.

### Langfuse Observability Plugin

The Langfuse plugin (`packages/plugin-langfuse`) provides comprehensive observability and cost tracking for AI model usage:

**Key Features:**

- **Real-time Cost Tracking**: Monitor expenses across all AI providers (OpenAI, Anthropic, Google, etc.)
- **Intelligent Model Detection**: Automatically identifies actual model names from responses
- **Token Usage Analytics**: Detailed breakdowns of input/output tokens per request
- **Performance Monitoring**: Track response times, efficiency scores, and usage patterns
- **Production Alerts**: Get notified about cost spikes or unusual usage

**Configuration:**

```bash
# Monitoring and Observability (optional but recommended)
LANGFUSE_SECRET_KEY=<your_secret_key>
LANGFUSE_PUBLIC_KEY=<your_public_key>
LANGFUSE_BASEURL=https://cloud.langfuse.com  # or self-hosted URL
```

**What Gets Tracked:**

- Every AI model call (except embeddings to preserve API limits)
- Token usage (input/output) with accurate counts
- Cost calculations with 2025 pricing for 40+ models
- Response times and performance metrics
- User attribution and session grouping
- Model-specific metadata and custom attributes

**Benefits:**

- Understand your AI costs in real-time
- Identify expensive operations and optimize
- Monitor production usage patterns
- Debug issues with detailed traces
- Generate usage reports and analytics

The plugin automatically integrates with ElizaOS's runtime, requiring no code changes beyond adding to the character's plugin list.

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- The ElizaOS team for providing the underlying AI framework
- The open-source community for supporting scientific AI development

---

For more information about biological AI agents and scientific research tools, visit our documentation and community resources.
