# Use Bun official image
FROM oven/bun:1 AS base

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install ALL dependencies (needed for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the client
RUN cd client && bun run build

# Remove dev dependencies after build
RUN bun install --frozen-lockfile --production

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Run as non-root user for security
USER bun

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e 'fetch("http://localhost:3000/api/auth/status").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Start the server
CMD ["bun", "run", "src/index.ts"]
