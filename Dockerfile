# Use latest Bun official image with full Node.js compatibility
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install ALL dependencies (needed for build)
# Don't use --frozen-lockfile in production builds (causes issues if lock is out of sync)
RUN bun install

# Copy source code
COPY . .

# Build the client
RUN cd client && bun run build

# Remove dev dependencies after build
RUN bun install --production

# Ensure all files are readable by bun user
RUN chmod -R 755 /app/src && \
    chown -R bun:bun /app

# Expose port
EXPOSE 3000

# Set production environment with Node.js compatibility
ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp
# Bind to all interfaces (0.0.0.0) not just localhost
ENV HOST=0.0.0.0

# Run as non-root user for security
USER bun

# Health check (use Bun's fetch, no curl needed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e 'fetch("http://localhost:3000/api/health").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Default: run API server
# Override with CMD ["bun", "run", "src/worker.ts"] for worker container
CMD ["bun", "run", "src/index.ts"]
