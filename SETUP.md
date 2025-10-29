## Quick Start

### Prerequisites

- [bun](https://bun.sh/docs/installation) (required package manager)
- Node.js v23.3.0

### Install Dependencies

```bash
git clone https://github.com/bio-xyz/BioAgents.git
cd BioAgents
bun install
```

```bash
# Fill out your API keys
cp .env.example .env
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
