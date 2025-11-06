# BioAgents AgentKit

An advanced AI agent framework for biological and scientific research. BioAgents provides powerful conversational AI capabilities with specialized knowledge in biology, life sciences, and scientific research methodologies.

## Setup

Check out [SETUP.md](SETUP.md)

## Agent Backend

### Routes

The agent primarily operates through the [/api/chat](src/routes/chat.ts) route. The [deep research](src/routes/deep-research.ts) route is coming soon.

You can define and modify the agent's flow in the chat route. It currently calls the planning tool, and based on the planning tool's results, calls other tools—generally all providers first, then all actions, with some exceptions.

### Tools

[Tools](src/tools) are the core concept in this repository. We separate different logic into tools—including a planning tool, file upload tool, hypothesis tool, knowledge tool, knowledge graph tool, reply tool, and semantic search tool, with more coming soon.

You can enable/disable each tool by switching the enabled boolean.

### State

State is a key concept for tools. The message state contains all important information from processing a message—which science papers were cited, which knowledge was used, which files were uploaded, etc. Since state is stored as a large JSON object, you should ideally set up a database trigger to clear message states older than ~30 minutes. We plan to introduce a 'conversation' state soon, which will represent permanent conversation state and summarize the most important takeaways.

To add a new tool, create a folder in the tools directory, place the main logic in index.ts, and put additional logic in separate files within that folder. Logic shared across multiple tools should go in [utils](src/utils).

### LLM Library

The [LLM library](src/llm) is another important component we've built. It allows you to use any Anthropic/OpenAI/Google or OpenRouter LLM via the [same interface](src/llm/provider.ts). Examples of calling our LLM library can be found in most tools in the repository.

We also support [Anthropic skills](src/llm/skills/skills.ts). To add a skill, place it in the [.claude/skills](.claude/skills) directory.

### Knowledge Tool & Document Processing

The knowledge tool includes vector database and embedding support in [embeddings](src/embeddings). We also use a Cohere reranker, so if you want to leverage it, make sure to set up a Cohere API key.

To process documents for the knowledge tool's vector database, place them in the [docs directory](docs). Documents are processed on each run but never processed twice for the same document name.

**Docker Deployment Note**: When deploying with Docker, agent-specific documentation in `docs/` and branding images in `client/public/images/` are persisted using Docker volumes. These directories are excluded from git (see `.gitignore`) but automatically mounted in your Docker containers via volume mounts defined in `docker-compose.yml`. This allows you to customize your agent with private documentation without committing it to the repository.

### Character File

The [character file](src/character.ts) defines your agent's persona, behavior, and response templates. Customize it to configure:

- **Name & System Prompt**: Define the agent's identity and core instructions
- **Response Templates**: Customize prompts for different contexts (chat replies, planning, hypothesis generation, Twitter responses)

To create your own character, modify `src/character.ts` or create a new character file with the same structure.

## UI

**Component system:**

- Custom hooks in `client/src/hooks/`
- UI components in `client/src/components/ui/`
- Lucide icons via `client/src/components/icons/`

**Styling:**

- Main styles: `client/src/styles/global.css`
- Button styles: `client/src/styles/buttons.css`
- Mobile-first responsive design

**Payment Integration:**

The UI includes integrated support for x402 micropayments using Coinbase embedded wallets:

- Embedded wallet authentication via `client/src/components/EmbeddedWalletAuth.tsx`
- x402 payment hooks in `client/src/hooks/useX402Payment.ts`
- Seamless USDC payment flow for paid API requests
- Toast notifications for payment status

## x402 Payment Protocol

BioAgents AgentKit supports **USDC micropayments** for API access using the x402 payment protocol. The system implements a **three-tier access control model**:

| Access Tier | Authentication | Payment Required |
|------------|----------------|------------------|
| **Next.js Frontend** | Privy JWT | ❌ FREE (bypasses x402) |
| **Internal Dev UI** | CDP Wallet | ✅ Requires x402 |
| **External Agents** | None | ✅ Requires x402 |

### Quick Start

#### Testnet Setup (Development)

1. **Enable x402 on testnet**:
```bash
X402_ENABLED=true
X402_ENVIRONMENT=testnet
X402_PAYMENT_ADDRESS=0xYourBaseSepoliaAddress
```

2. **Configure Authentication** (optional - for Privy bypass):
```bash
# Optional: Only needed if using Privy authentication
PRIVY_APP_ID=your_app_id
PRIVY_VERIFICATION_KEY="your_public_key"
```

3. **Get CDP Credentials** from [Coinbase Portal](https://portal.cdp.coinbase.com) (for embedded wallets):
```bash
CDP_PROJECT_ID=your_project
```

#### Mainnet Setup (Production)

1. **Enable x402 on mainnet**:
```bash
X402_ENABLED=true
X402_ENVIRONMENT=mainnet
X402_PAYMENT_ADDRESS=0xYourBaseMainnetAddress
```

2. **REQUIRED: Get CDP API Credentials** from [CDP API Portal](https://portal.cdp.coinbase.com/access/api):
```bash
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_SECRET=your_key_secret
```

Note: Mainnet requires CDP API credentials. The system automatically uses the CDP facilitator object for mainnet (not URL-based).

### Features

- **Three-Tier Access Control**: Privy bypass, CDP auth, or pay-per-request
- **Gasless Transfers**: EIP-3009 for fee-free USDC payments on Base
- **Persistent Conversations**: External agents can maintain multi-turn chats
- **Route-Based Pricing**: Simple flat pricing ($0.01/request default)
- **Embedded Wallets**: Email-based wallet creation

**📖 For complete documentation, configuration, and implementation details, see [x402.md](x402.md)**

## Project Structure

```
├── src/                      # Backend source
│   ├── routes/              # HTTP route handlers
│   │   └── chat.ts          # Main chat endpoint (orchestrates services)
│   ├── services/            # Business logic layer
│   │   └── chat/            # Chat-related services
│   │       ├── setup.ts     # User/conversation setup
│   │       ├── payment.ts   # Payment recording
│   │       └── tools.ts     # Tool execution logic
│   ├── middleware/          # Request/response middleware
│   │   ├── smartAuth.ts     # Multi-method authentication
│   │   └── x402.ts          # Payment enforcement
│   ├── tools/               # Agent tools (PLANNING, REPLY, etc.)
│   ├── llm/                 # LLM providers & interfaces
│   ├── db/                  # Database operations
│   │   ├── operations.ts    # Core DB operations
│   │   └── x402Operations.ts # Payment tracking
│   ├── x402/                # x402 payment protocol
│   │   ├── config.ts        # Network & payment config
│   │   ├── pricing.ts       # Route-based pricing
│   │   └── service.ts       # Payment verification
│   ├── utils/               # Shared utilities
│   └── types/               # TypeScript types
├── client/                  # Frontend UI
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom hooks
│   │   └── styles/         # CSS files
│   └── public/             # Static assets
└── package.json
```

---

Built with [Bun](https://bun.com) - A fast all-in-one JavaScript runtime.
