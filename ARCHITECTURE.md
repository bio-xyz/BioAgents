# BioAgents Architecture

Complete separation of frontend and backend code following industry best practices.

## 📁 Project Structure

```
bioagents-agentkit/
├── client/                      # 🎨 FRONTEND (Preact UI)
│   ├── src/
│   │   └── index.js            # Main Preact app (all components)
│   ├── public/
│   │   └── index.html          # HTML template with embedded CSS
│   ├── dist/                   # Build output (gitignored)
│   │   ├── index.html         # Copied from public/
│   │   └── app.js             # Bundled ~1MB (Preact + deps)
│   ├── build.ts               # Build script
│   └── README.md              # Client documentation
│
├── src/                        # 🔧 BACKEND (Node.js/Bun)
│   ├── agents/                # Agent implementations
│   ├── llm/                   # LLM provider adapters
│   ├── tools/                 # Tool system
│   ├── types/                 # Type definitions
│   ├── utils/                 # Utilities
│   └── index.ts               # Elysia server
│
├── scripts/                    # Build/utility scripts
├── .gitignore                 # Ignores client/dist/
├── package.json               # Dependencies & scripts
├── tsconfig.json              # TypeScript config
└── README.md                  # Project documentation
```

## 🎯 Complete Separation

### ✅ What's in `client/`
- **ALL UI code** - Preact components, styles, assets
- **Build system** - `build.ts` script
- **No backend code** - Zero dependencies on `src/`

### ✅ What's in `src/`
- **ALL backend code** - API, tools, agents, LLM adapters
- **No UI code** - Zero frontend files
- **Serves** - Only serves built files from `client/dist/`

## 🚀 Development Workflow

### 1. Build the Client
```bash
# Build frontend (required before first run)
bun run build:client
```

### 2. Start the Server
```bash
# Start backend with auto-reload
bun run dev
```

### 3. Make Changes

**Frontend changes:**
```bash
# 1. Edit client/src/index.js or client/public/index.html
# 2. Rebuild
bun run build:client
# 3. Refresh browser
```

**Backend changes:**
```bash
# Server auto-reloads with --watch flag
# Just edit src/ files and save
```

## 📦 Build Process

### Client Build (`bun run build:client`)
1. Bundles `client/src/index.js` with all dependencies
2. Minifies JavaScript (~1MB output)
3. Copies `client/public/index.html` to `client/dist/`
4. Output: `client/dist/app.js` + `client/dist/index.html`

### What Gets Bundled
- ✅ Preact (3kb framework)
- ✅ Marked (markdown parser)
- ✅ DOMPurify (XSS sanitizer)
- ✅ Highlight.js (code highlighter)
- ✅ All app components

## 🌐 Server Routes

```typescript
// Frontend
GET  /              → client/dist/index.html
GET  /app.js        → client/dist/app.js

// API
POST /api/chat      → Chat endpoint (JSON)
```

## 🔄 How It Works

1. **User visits** `http://localhost:3000`
2. **Server serves** `client/dist/index.html`
3. **Browser loads** `<script src="/app.js"></script>`
4. **Server serves** `client/dist/app.js` (bundled Preact app)
5. **Preact renders** the UI
6. **User sends message** → `POST /api/chat`
7. **Server processes** via tools/agents/LLM
8. **Response streams** back to UI

## 📜 Scripts

```json
{
  "dev": "bun --watch src/index.ts",      // Backend dev server
  "start": "bun src/index.ts",             // Production server
  "build:client": "bun run client/build.ts", // Build frontend
  "build": "bun run build:client"          // Alias
}
```

## 🔒 Git Ignore

```gitignore
# Build outputs (not committed)
client/dist/
*.bundle.js

# Dependencies
node_modules/

# Environment
.env
```

## 🎨 Client Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Preact** | 10.27.2 | 3kb React alternative |
| **Marked** | 16.4.1 | Markdown → HTML |
| **DOMPurify** | 3.3.0 | XSS protection |
| **Highlight.js** | 11.11.1 | Code highlighting |
| **Bun** | 1.2.22+ | Build tool & bundler |

## 🔧 Backend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Elysia** | 1.4.12 | Bun-first web framework |
| **TypeScript** | 5.x | Type safety |
| **OpenAI SDK** | 0.66.0 | LLM integration |
| **Anthropic SDK** | 0.66.0 | Claude integration |
| **Google GenAI** | 1.25.0 | Gemini integration |
| **Zod** | 3.x | Runtime validation |

## ✅ Benefits of This Architecture

### 1. **Clear Separation**
- Frontend devs work in `client/`
- Backend devs work in `src/`
- No confusion about file locations

### 2. **Independent Builds**
- Client can be built separately
- Backend doesn't need frontend to run (serves from dist/)
- Can deploy client to CDN if needed

### 3. **Better Performance**
- Single bundled JS file (~1MB minified)
- All dependencies included
- No module resolution at runtime

### 4. **Cleaner Git**
- `client/dist/` is gitignored
- Only source code is committed
- Smaller repository size

### 5. **Industry Standard**
- Follows React/Next.js/Vite conventions
- Easy for new devs to understand
- Scalable architecture

### 6. **Deployment Flexibility**
```bash
# Option 1: Serve from same server (current)
bun src/index.ts

# Option 2: Deploy client to CDN
aws s3 sync client/dist/ s3://my-bucket/

# Option 3: Separate deployments
# - Vercel for client/
# - Railway for src/
```

## 🔄 Future Enhancements

- [ ] **Watch mode** - Auto-rebuild client on changes
- [ ] **Hot Module Reload** - No browser refresh needed
- [ ] **Source maps** - Better debugging
- [ ] **CSS extraction** - Separate stylesheet
- [ ] **Component splitting** - Break index.js into files
- [ ] **Environment-based builds** - dev vs prod configs
- [ ] **Bundle analysis** - Optimize bundle size

## 📝 Best Practices

### Frontend (client/)
- Keep all UI code in `client/src/`
- Styles in `client/public/index.html` or separate CSS
- Build before committing to test
- Keep bundle size reasonable (<2MB)

### Backend (src/)
- Never import from `client/`
- Only serve files from `client/dist/`
- Use Bun.file() for static files
- Keep API routes in `src/index.ts`

### Both
- Run `bun run build:client` before `git commit`
- Test locally before pushing
- Keep dependencies updated
- Document major changes

## 🆘 Troubleshooting

### Black screen on `/`
```bash
# Rebuild the client
bun run build:client

# Check build output exists
ls -lh client/dist/

# Should see: index.html, app.js
```

### Server errors
```bash
# Check server logs
# Look for "server_listening" message

# Restart server
bun run dev
```

### Build failures
```bash
# Check for syntax errors in client/src/index.js
# Ensure all imports are valid
# Check Bun version: bun --version
```

## 📚 Additional Documentation

- [client/README.md](client/README.md) - Frontend documentation
- [README.md](README.md) - Project overview
- [CLAUDE.md](CLAUDE.md) - Bun-first development guide

---

**This architecture ensures complete separation between frontend and backend code, following industry best practices and enabling scalable development.** 🎉
