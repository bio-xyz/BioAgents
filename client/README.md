# BioAgents Client (Preact UI)

Preact-based frontend for the BioAgents chat interface with fully component-based architecture.

## 📁 Structure

```
client/
├── src/
│   ├── index.jsx              # Entry point - renders App
│   ├── App.jsx                # Main App component with state management
│   ├── components/            # Preact components
│   │   ├── Header.jsx         # App header with title
│   │   ├── WelcomeScreen.jsx  # Initial welcome screen with suggestions
│   │   ├── Message.jsx        # Chat message component (user/assistant)
│   │   ├── TypingIndicator.jsx # Animated typing indicator
│   │   ├── ChatInput.jsx      # Message input with send button
│   │   └── ErrorMessage.jsx   # Error banner component
│   └── utils/
│       └── helpers.js         # Utility functions
├── public/
│   └── index.html             # HTML template with all CSS
├── dist/                      # Build output (gitignored)
│   ├── index.html            # Copied from public/
│   ├── app.js                # Bundled ~1MB (Preact + deps)
│   └── app.js.map            # Source map for debugging
└── build.ts                   # Build script
```

## 🚀 Development

### Build the Client
```bash
# From project root
bun run build:client

# Or directly
bun run client/build.ts
```

This will:
1. Bundle all Preact components from `src/index.jsx`
2. Include all dependencies (Preact, Marked, DOMPurify, Highlight.js)
3. Minify the output
4. Copy `public/index.html` to `dist/`
5. Output `app.js` (~1MB) and source map to `dist/`

### Start Development Server
```bash
# From project root
bun run dev
```

The server will serve:
- `GET /` → `client/dist/index.html`
- `GET /app.js` → `client/dist/app.js`
- `POST /api/chat` → Backend API

Visit: http://localhost:3000

### Making Changes

**To modify UI:**
1. Edit files in `client/src/` or `client/public/index.html`
2. Run `bun run build:client`
3. Refresh browser

**Hot reload:** Not yet implemented - manual rebuild required

## 🛠 Technology Stack

| Package | Version | Purpose |
|---------|---------|---------|
| **Preact** | 10.27.2 | 3kb React alternative |
| **Marked** | 16.4.1 | Markdown → HTML rendering |
| **DOMPurify** | 3.3.0 | XSS protection for HTML |
| **Highlight.js** | 11.11.1 | Syntax highlighting for code blocks |

## 📦 Components Overview

### App.jsx
Main application component that manages:
- Message state (user & assistant messages)
- Loading/typing states
- Error handling
- API communication with `/api/chat`
- Streaming animation effect

### Components

#### Header
Simple header showing app title and subtitle.

#### WelcomeScreen
Displays when no messages exist, shows:
- Welcome message
- 4 example prompts as suggestion cards

#### Message
Renders individual chat messages:
- **User messages:** Plain text
- **Assistant messages:** Markdown rendered with syntax highlighting
- Uses DOMPurify to sanitize HTML
- Auto-highlights code blocks with Highlight.js

#### TypingIndicator
Animated three-dot indicator shown while waiting for API response.

#### ChatInput
Text input with send button:
- Auto-expands textarea
- Send on Enter (Shift+Enter for new line)
- Disabled state during loading

#### ErrorMessage
Dismissible error banner for API errors.

## 🎨 Styling

All CSS is embedded in `client/public/index.html` using CSS variables for theming:

```css
:root {
  --bg-primary: #000000;
  --bg-secondary: #0a0a0a;
  --bg-tertiary: #141414;
  --text-primary: #ffffff;
  --accent-color: #10a37f;
  /* ... more variables */
}
```

**Theme:** Black background with minimal white text, ChatGPT-inspired design.

## 🔄 Build Process

The `build.ts` script uses **Bun.build** to:
1. Parse JSX using Preact's `h()` function
2. Bundle all imports (node_modules + local files)
3. Minify JavaScript
4. Generate source maps
5. Copy HTML template

**Output:**
- `client/dist/app.js` - ~1MB minified bundle
- `client/dist/app.js.map` - Source map
- `client/dist/index.html` - HTML with CSS

## Why Separate?

**Benefits of `client/` folder:**
- ✅ Clear separation: frontend vs backend code
- ✅ Independent builds: UI can be built separately
- ✅ Better organization: follows industry standards
- ✅ Easier deployment: can deploy client separately (CDN, etc.)
- ✅ Cleaner git: dist/ is gitignored
- ✅ Future-proof: easy to add more client tools

## Server Integration

The server (`src/index.ts`) serves the built files:
```typescript
.get("/", () => Bun.file("client/dist/index.html"))
.get("/app.js", () => Bun.file("client/dist/app.js"))
```

## Future Improvements

- [ ] Watch mode for auto-rebuild
- [ ] Source maps for debugging
- [ ] CSS extraction to separate file
- [ ] Split components into separate files
- [ ] Hot module reloading (HMR)
- [ ] Bundle size optimization
