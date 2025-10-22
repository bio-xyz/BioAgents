# 🐳 Docker Deployment

Simple Docker deployment guide for BioAgents. Works with Coolify and any Docker environment.

---

## 📦 Files

- **`Dockerfile`** - Builds the application image
- **`docker-compose.yml`** - Orchestrates the deployment
- **`.dockerignore`** - Optimizes build size

---

## 🚀 Local Testing

### With Docker Compose (Recommended):
```bash
docker-compose up
```

### Or with Docker directly:
```bash
# Build
docker build -t bioagents .

# Run
docker run -p 3000:3000 --env-file .env bioagents
```

Access at `http://localhost:3000`

---

## 🔧 Environment Variables

Create `.env` file with:

```bash
# Required
OPENAI_API_KEY=your_key

# Optional: UI Password Protection
UI_PASSWORD=your_password

# Optional: Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_key

# Optional: Other LLM Providers
ANTHROPIC_API_KEY=your_key
GOOGLE_API_KEY=your_key
OPENROUTER_API_KEY=your_key
```

---

## 🎯 Coolify Deployment

Coolify automatically detects the `Dockerfile` and deploys your application.

### Steps:
1. Push your code to Git repository
2. In Coolify, create new application
3. Connect your Git repository
4. Add environment variables in Coolify dashboard
5. Deploy

Coolify will:
- ✅ Build using `Dockerfile`
- ✅ Handle environment variables
- ✅ Provide automatic HTTPS
- ✅ Auto-deploy on git push

---

## 📊 Dockerfile Overview

```dockerfile
FROM oven/bun:1
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
COPY client/package.json client/bun.lockb ./client/
RUN bun install --frozen-lockfile

# Build client
COPY . .
RUN cd client && bun run build

# Start server
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

---

## 🔍 Health Check

```bash
curl http://localhost:3000/api/auth/status
```

Expected response:
```json
{
  "isAuthRequired": true,
  "isAuthenticated": false
}
```

---

## 📚 Related Documentation

- **[SECURITY.md](SECURITY.md)** - Authentication documentation
- **[README.md](README.md)** - Project overview
- **[.env.example](.env.example)** - Configuration reference

---

**Made with ✨ by BioAgents**
