# Use Bun official image
FROM oven/bun:1 AS base

# Set working directory
WORKDIR /app

# Install dependencies for both root and client
COPY package.json bun.lockb ./
COPY client/package.json client/bun.lockb ./client/
RUN bun install --frozen-lockfile
RUN cd client && bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the client
RUN cd client && bun run build

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["bun", "run", "src/index.ts"]
