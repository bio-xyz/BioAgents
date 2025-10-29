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
