# Use latest Bun official image with full Node.js compatibility
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# --- OPTIMIZED SUPABASE CLI INSTALLATION ---
# Use ADD for a direct, cached download. This is much faster and more reliable.
# Docker caches the download, so it only happens once if the remote file doesn't change.
ADD https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz /tmp/supabase.tar.gz

# Install the CLI system-wide as the root user and make it executable.
# This ensures it's available to the non-root 'bun' user later.
RUN tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/supabase && \
    rm /tmp/supabase.tar.gz
# --- END OF SUPABASE CLI INSTALLATION ---

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

# Default: run migrations then API server
CMD ["sh", "-c", "supabase migration up && bun run src/index.ts"]