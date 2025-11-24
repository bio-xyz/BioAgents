# BioAgents Documentation

This folder contains the complete documentation for BioAgents, built with Docusaurus.

**Official Repository:** [https://github.com/bio-xyz/BioAgents](https://github.com/bio-xyz/BioAgents)

## 📚 Documentation Structure

The documentation is organized into **10 main sections**:

1. **Introduction** - Overview, key features, and use cases
2. **Getting Started** - Installation and quick start guide
3. **Core Concepts** - Architecture, state management, and character system
4. **Agent Framework** - Routes, tools, LLM library, embeddings, and middleware
5. **Deep Research** - Advanced multi-step research capabilities
6. **Code Execution** - Bio Code Interpreter with E2B sandboxes
7. **Client UI** - Components, hooks, styling, and UI architecture
8. **x402 Payment System** - Payment integration, embedded wallets, and authentication
9. **API Reference** - Complete endpoint documentation
10. **Deployment** - Docker, production setup, and database configuration
11. **Guides** - Step-by-step tutorials for common tasks
12. **Changelog** - Version history and updates

## 🚀 Quick Start

### Local Development

```bash
cd documentation
bun install

# Option 1: Start with search (builds index first)
bun run dev

# Option 2: Just start without search
bun run start
```

The documentation will be available at `http://localhost:3000` and will show the docs directly (no separate landing page).

**Note:** Use `bun run dev` to enable search functionality in development mode (it builds the search index first).

### Production Build

```bash
bun run build
```

Generates static content in the `build` directory.

### Serve Production Build

```bash
bun run serve
```

## 🐳 Docker Deployment

### Option 1: Standalone Docker

```bash
cd documentation
docker build -t bioagents-docs .
docker run -p 3001:80 bioagents-docs
```

Access at `http://localhost:3001`

### Option 2: With Docker Compose (Recommended)

From the project root:

```bash
docker-compose up -d docs
```

This starts:
- **Main App**: `http://localhost:3000`
- **Documentation**: `http://localhost:3001`

### Full Stack

```bash
docker-compose up -d
```

Starts both the main application and documentation.

## 📝 Writing Documentation

### Adding a New Page

1. Create a new `.md` file in the appropriate section folder under `docs/`
2. Add frontmatter:
```markdown
---
sidebar_position: <number>
---

# Page Title
```

### Creating a New Section

1. Create a new folder under `docs/`
2. Add a `_category_.json` file:
```json
{
  "label": "Section Name",
  "position": <number>,
  "link": {
    "type": "generated-index",
    "description": "Section description"
  }
}
```

## 🗂️ Current Status

✅ All dummy template content has been removed
✅ Complete documentation structure created with titles and subtitles
✅ Build system verified and working
✅ Sidebar auto-generated from folder structure
✅ Search functionality enabled
✅ "Copy page as Markdown" feature for AI agents
✅ Docker deployment ready
⏳ Content needs to be written for each section

## 🔧 Configuration

The documentation is configured for:
- **Docs-only mode**: Documentation is served directly at the root URL (`/`)
- **Search functionality**: Local search with keyboard shortcuts (Ctrl/Cmd + K)
- BioAgents branding
- Auto-generated sidebar from folder structure with visual separators
- Blog disabled (can be re-enabled if needed)
- Dark mode support with system preference detection
- No separate landing page - users go straight to the docs
- **Edit on GitHub**: Enabled with direct links to source files
- **Copy as Markdown**: Button on every page for AI agent integration

## 📁 Key Files

- `docusaurus.config.ts` - Main configuration
- `sidebars.ts` - Sidebar configuration (currently auto-generated)
- `docs/` - All documentation content
- `static/` - Static assets (images, etc.)
- `STRUCTURE.md` - Detailed breakdown of the documentation structure
- `Dockerfile` - Docker build configuration
- `nginx.conf` - Nginx server configuration

## 🌐 Production Hosting Options

### 1. Docker (Current Setup)
- Built-in Nginx server
- Optimized for production
- Gzip compression
- Health checks
- Port 3001

### 2. Vercel (Free, Easy)
```bash
# Deploy to Vercel
cd documentation
vercel
```

### 3. Netlify (Free, Easy)
```bash
# Deploy to Netlify
cd documentation
netlify deploy --prod --dir=build
```

### 4. GitHub Pages (Free)
```bash
# Configure in docusaurus.config.ts then:
cd documentation
bun run deploy
```

### 5. Custom Server
Build the static files and serve with any web server:
```bash
bun run build
# Copy ./build to your web server
```

## 📄 License

Same as the main BioAgents project.
