# Multi-stage build for Docusaurus documentation
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Set base URL for /docs path
ENV DOCS_BASE_URL=/docs/

# Build static site
RUN bun run build

# Production stage - serve with Bun
FROM oven/bun:latest

WORKDIR /app

# Copy built static files
COPY --from=builder /app/build ./public

# Copy static file server
COPY server.js ./server.js

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run -e "fetch('http://localhost:8080/docs/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "server.js"]

