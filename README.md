# BioAgents AgentKit

AI-powered biological research assistant with a modern chat UI.

## Quick Start

### Install Dependencies

```bash
bun install
```

### Development

**Run App:**

```bash
bun run dev
```

**Build UI only:**

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
