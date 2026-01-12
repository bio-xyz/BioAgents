# Autonomous Research Demo

An autonomous research demo that uses Claude Opus as a "scientific orchestrator" to conduct deep research on longevity/aging topics without human intervention.

## Features

- **3 Parallel Research Sessions**: Runs 3 independent research conversations simultaneously
- **Opus Orchestrator**: Claude Opus evaluates research progress and provides steering
- **Automatic Paper Generation**: When research is complete, generates a scientific paper
- **Archive View**: Browse completed research sessions and their generated papers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS DEMO (Port 3001)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      PREACT UI                                │   │
│  │  [Research #1]  [Research #2]  [Research #3]  [Archive]       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   ELYSIA SERVER                               │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │ ORCHESTRATOR SERVICE (Claude Opus 4.5)                 │  │   │
│  │  │ - Generates 3 longevity topics                         │  │   │
│  │  │ - Evaluates plans, provides steering                   │  │   │
│  │  │ - Decides when to conclude & archive                   │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                                │ HTTP
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MAIN BIOAGENTS SERVER (Port 3000)                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Prerequisites

- Bun runtime
- Main BioAgents server running on localhost:3000
- Supabase instance (can use the same as main server or a separate one)
- Anthropic API key

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required variables:
- `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude Opus
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `MAIN_SERVER_URL` - URL of the main BioAgents server (default: http://localhost:3000)

### 3. Database Setup

Create a new Supabase project and run the schema:

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **SQL Editor** in the dashboard
3. Copy the contents of `schema.sql` and run it
4. Copy your project URL and anon key from **Settings > API**

### 4. Install Dependencies

```bash
cd autonomous-demo
bun install
```

### 5. Build the Client

```bash
bun run build:client
```

### 6. Run the Server

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

The demo will be available at http://localhost:3001

## How It Works

### Orchestrator Flow

1. **Initialization**: On startup, Opus generates 3 diverse longevity research topics
2. **Research Iteration**: For each topic, the orchestrator sends a message to the main server's deep research API
3. **Evaluation**: After each iteration, Opus evaluates:
   - Is the research plan sound?
   - Are discoveries meaningful?
   - Should we continue, redirect, or conclude?
4. **Steering**: The orchestrator provides feedback to guide the next iteration
5. **Conclusion**: When research is sufficient (or max iterations reached), generates a paper and archives

### Orchestrator Decisions

- **CONTINUE**: Research is on track, provide guidance for next steps
- **REDIRECT**: Research went off-track, provide corrective guidance
- **CONCLUDE**: Sufficient discoveries made, trigger paper generation

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| GET | /api/sessions | Get all active sessions |
| GET | /api/sessions/:id | Get session with messages |
| GET | /api/sessions/:id/state | Get conversation state |
| POST | /api/sessions/:id/archive | Force-archive a session |
| GET | /api/archive | Get archived sessions |
| GET | /api/archive/:id | Get archived session + paper |
| POST | /api/restart | Generate new topics, start fresh |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| DEMO_PORT | 3001 | Demo server port |
| MAIN_SERVER_URL | http://localhost:3000 | Main BioAgents API |
| ORCHESTRATOR_MODEL | claude-opus-4-5-20251101 | Anthropic model |
| MIN_ITERATIONS | 3 | Minimum iterations before concluding |
| MAX_ITERATIONS | 15 | Maximum iterations per session |
| POLL_INTERVAL_MS | 3000 | Polling interval for research status |

## Development

### Watch Mode

Run client build in watch mode:
```bash
bun run build:client:watch
```

Run server in watch mode (separate terminal):
```bash
bun run dev
```

### File Structure

```
autonomous-demo/
├── src/
│   ├── index.ts                 # Elysia server entry
│   ├── routes/api.ts            # API routes
│   ├── services/
│   │   ├── orchestrator/        # Opus orchestrator
│   │   └── main-server-client.ts
│   ├── db/                      # Supabase operations
│   └── utils/                   # Config, logging
├── client/
│   ├── src/
│   │   ├── pages/               # DemoPage, ArchivePage
│   │   └── components/          # ConversationPanel, StatePanel
│   ├── build.ts                 # Bun build script
│   └── index.html
└── supabase/migrations/         # Database schema
```
