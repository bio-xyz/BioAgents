FROM node:23.3.0-slim AS builder
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \ 
    g++ \
    git \
    make \
    python3 \
    unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g bun@1.2.5 turbo@2.3.3

RUN ln -s /usr/bin/python3 /usr/bin/python

COPY package.json bun.lock turbo.json tsconfig.json lerna.json renovate.json .npmrc ./
COPY scripts ./scripts
COPY packages ./packages

RUN rm -rf node_modules

RUN SKIP_POSTINSTALL=1 bun install --no-cache
ENV PATH="/root/.bun/bin:/usr/local/bin:${PATH}"


# Build packages with selective dependency resolution
# Build project-starter + dependencies, CLI, and server for runtime
RUN turbo run build --filter=!@elizaos/autodoc --filter=!@elizaos/docs

# Debug and verify critical build outputs exist
RUN echo "=== Checking build outputs ===" && \
    ls -la packages/*/dist/ 2>/dev/null || echo "Some packages have no dist directory" && \
    echo "=== Core ===" && ls -la packages/core/dist/ 2>/dev/null || echo "Core dist missing" && \
    echo "=== CLI ===" && ls -la packages/cli/dist/ 2>/dev/null || echo "CLI dist missing" && \
    echo "=== Project Starter ===" && ls -la packages/project-starter/dist/ 2>/dev/null || echo "Project starter dist missing" && \
    echo "=== Plugin SQL ===" && ls -la packages/plugin-sql/dist/ 2>/dev/null || echo "Plugin SQL dist missing" && \
    echo "=== Plugin Bootstrap ===" && ls -la packages/plugin-bootstrap/dist/ 2>/dev/null || echo "Plugin bootstrap dist missing" && \
    echo "=== Server ===" && ls -la packages/server/dist/ 2>/dev/null || echo "Server dist missing"

# Verify essential build outputs exist (relaxed for debugging)
RUN test -f packages/core/dist/index.js && \
    test -f packages/project-starter/dist/index.js && \
    test -f packages/plugin-sql/dist/index.js && \
    test -f packages/plugin-bootstrap/dist/index.js && \
    test -f packages/server/dist/index.js

FROM node:23.3.0-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    git \
    python3 \
    unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g bun@1.2.5 turbo@2.3.3

# Copy global bun installation from builder (includes elizaos CLI)
COPY --from=builder /root/.bun /root/.bun
ENV PATH="/root/.bun/bin:${PATH}"

# Copy monorepo structure from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/turbo.json ./
COPY --from=builder /app/lerna.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/bun.lock ./bun.lock

ENV NODE_ENV=production

EXPOSE 3000
EXPOSE 50000-50100/udp

WORKDIR /app/packages/project-starter
RUN bun install
CMD ["bun", "start"]