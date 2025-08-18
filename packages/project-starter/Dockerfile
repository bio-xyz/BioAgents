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

RUN npm install -g bun@1.2.5

RUN ln -s /usr/bin/python3 /usr/bin/python

COPY package.json bun.lock ./
COPY tsconfig.json tsconfig.build.json tsup.config.ts vitest.config.ts ./
COPY src ./src
COPY docs ./docs
COPY scripts ./scripts

RUN rm -rf  node_modules

RUN bun install --no-cache

RUN bun run build

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

RUN npm install -g bun@1.2.5
RUN bun add -g @elizaos/cli@latest

# Ensure the global bun bin directory is in PATH
ENV PATH="/root/.bun/bin:/usr/local/bin:${PATH}"

# Verify elizaos installation
RUN which elizaos && elizaos --version

COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/tsconfig.build.json ./
COPY --from=builder /app/tsup.config.ts ./
COPY --from=builder /app/vitest.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/scripts ./scripts

ENV NODE_ENV=production

EXPOSE 3000
EXPOSE 50000-50100/udp

CMD ["bunx", "elizaos", "start"]
