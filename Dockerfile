# Use latest Bun official image with full Node.js compatibility
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# Install ca-certificates and LaTeX (for paper generation)
# Using XeLaTeX for native Unicode support (handles β, ′, accented chars, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  texlive-latex-base \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-bibtex-extra \
  texlive-xetex \
  latexmk \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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

# Start the API server
CMD ["bun", "run", "src/index.ts"]