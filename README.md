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

### State

State is a key concept for tools. The message state contains all important information from processing a message—which science papers were cited, which knowledge was used, which files were uploaded, etc. Since state is stored as a large JSON object, you should ideally set up a database trigger to clear message states older than ~30 minutes. We plan to introduce a 'conversation' state soon, which will represent permanent conversation state and summarize the most important takeaways.

To add a new tool, create a folder in the tools directory, place the main logic in index.ts, and put additional logic in separate files within that folder. Logic shared across multiple tools should go in [utils](src/utils).

### LLM Library

The [LLM library](src/llm) is another important component we've built. It allows you to use any Anthropic/OpenAI/Google or OpenRouter LLM via the [same interface](src/llm/provider.ts). Examples of calling our LLM library can be found in most tools in the repository.

We also support [Anthropic skills](src/llm/skills/skills.ts). To add a skill, place it in the [.claude/skills](.claude/skills) directory.

### Knowledge Tool & Document Processing

The knowledge tool includes vector database and embedding support in [embeddings](src/embeddings). We also use a Cohere reranker, so if you want to leverage it, make sure to set up a Cohere API key.

To process documents for the knowledge tool's vector database, place them in the [docs directory](docs). Documents are processed on each run but never processed twice for the same document name.

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

BioAgents AgentKit supports USDC micropayments for API access using the x402 payment protocol with Coinbase's embedded wallet infrastructure.

### Features

- **Gasless Transfers**: Uses EIP-3009 for fee-free USDC transfers on Base
- **Embedded Wallets**: Email-based wallet creation via Coinbase Developer Platform
- **HTTP 402 Flow**: Standard "Payment Required" protocol for API monetization
- **Base Network**: Supports both Base Sepolia (testnet) and Base (mainnet)

### Configuration

1. Set up your payment receiver address:
```bash
X402_ENABLED=true
X402_PAYMENT_ADDRESS=0xYourWalletAddress
```

2. Get Coinbase CDP credentials from [Coinbase Developer Portal](https://portal.cdp.coinbase.com):
```bash
# API credentials for backend
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_SECRET=your_key_secret

# Project ID for embedded wallets (frontend)
CDP_PROJECT_ID=your_project_id
```

3. Configure network (see `.env.example` for all options):
```bash
X402_NETWORK=base-sepolia  # or 'base' for mainnet
X402_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Base Sepolia USDC
```

### Payment Flow

1. User connects wallet via email (embedded wallet created automatically)
2. User makes a request to `/api/chat`
3. Server responds with 402 Payment Required + payment details
4. Client signs payment authorization (gasless EIP-3009 transfer)
5. Client retries request with payment proof
6. Server verifies and processes the request

### Database Schema

Payment records are stored in the `x402_payments` table (see `scripts/db/setup.sql`):

```sql
CREATE TABLE x402_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL,
  user_id TEXT,
  transaction_hash TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

For more details on x402 implementation, see:
- Backend: `src/x402/` directory
- Frontend: `client/src/hooks/useX402Payment.ts` and `client/src/hooks/useEmbeddedWallet.ts`

## Project Structure

```
├── src/                    # Backend source
│   ├── tools/             # Agent tools
│   ├── llm/               # LLM providers
│   └── types/             # TypeScript types
├── client/                # Frontend UI
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom hooks
│   │   └── styles/       # CSS files
│   └── public/           # Static assets
└── package.json
```

---

Built with [Bun](https://bun.com) - A fast all-in-one JavaScript runtime.
