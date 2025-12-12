# Use latest Bun official image with full Node.js compatibility
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install ALL dependencies (needed for build)
RUN bun install

# Copy source code
COPY . .

# Fix permissions on source files only (not node_modules)
RUN chmod -R 755 /app/src /app/client

# Build the client
RUN cd client && bun run build

# Remove dev dependencies after build
RUN bun install --production

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp
ENV HOST=0.0.0.0

# Run as non-root user for security
USER bun

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e 'fetch("http://localhost:3000/api/health").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Default: run API server
CMD ["bun", "run", "src/index.ts"]
