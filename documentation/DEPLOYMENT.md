# Documentation Deployment Guide

This guide covers deploying the BioAgents documentation using Docker and Coolify.

## Deployment Options

### Option 1: Root Path Deployment (Default)

Deploy documentation at the root of a domain (e.g., `docs.bioagents.io`)

**Docker Run:**
```bash
docker-compose up -d docs
```

**Access:** `http://your-domain.com/`

---

### Option 2: Subdirectory Deployment (e.g., /docs)

Deploy documentation at a subdirectory path (e.g., `bioagents.io/docs`)

**Build with custom base URL:**
```bash
cd documentation
DOCS_BASE_URL=/docs/ bun run build
docker build -t bioagents-docs .
```

**Or use Docker Compose with environment variables:**
```yaml
services:
  docs:
    build:
      context: ./documentation
      args:
        DOCS_BASE_URL: /docs/
    ports:
      - "3001:80"
```

**Access:** `http://your-domain.com/docs/`

---

## Coolify Deployment

### Prerequisites
- Coolify instance running
- GitHub repository connected
- Domain configured in Coolify

### Setup Steps

#### 1. Create New Service in Coolify

1. Go to your Coolify dashboard
2. Click "New Resource" → "Docker Compose"
3. Select your GitHub repository
4. Choose the branch (e.g., `main`)

#### 2. Configure Docker Compose

Use this configuration in Coolify:

```yaml
version: "3.8"

services:
  docs:
    build: ./documentation
    container_name: bioagents-docs
    restart: unless-stopped
    environment:
      # Set these in Coolify environment variables
      - DOCS_URL=${DOCS_URL}
      - DOCS_BASE_URL=${DOCS_BASE_URL}
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

#### 3. Set Environment Variables in Coolify

For **root deployment** (e.g., `docs.bioagents.io`):
```
DOCS_URL=https://docs.bioagents.io
DOCS_BASE_URL=/
```

For **subdirectory deployment** (e.g., `bioagents.io/docs`):
```
DOCS_URL=https://bioagents.io
DOCS_BASE_URL=/docs/
```

#### 4. Configure Domain in Coolify

**For root deployment:**
- Set domain: `docs.bioagents.io`
- Enable SSL/TLS (Let's Encrypt)
- Container port: `80`

**For subdirectory deployment:**
- Set domain: `bioagents.io`
- Add path prefix: `/docs`
- Enable SSL/TLS
- Container port: `80`

#### 5. Deploy

Click "Deploy" in Coolify. The service will:
1. Clone your repository
2. Build the Docker image with Bun
3. Generate static files
4. Serve via Nginx
5. Configure SSL automatically

---

## Nginx Configuration

The documentation uses a flexible Nginx configuration that supports both deployment types:

- **Root deployment**: Serves directly from `/`
- **Subdirectory deployment**: Supports `/docs` path with proper routing

The Nginx config includes:
- Gzip compression for faster loading
- Security headers
- Static asset caching (1 year)
- Proper 404 handling
- Health check endpoint

---

## Docker Compose (Standalone)

For standalone deployment without Coolify:

```yaml
services:
  docs:
    build: ./documentation
    ports:
      - "3001:80"
    environment:
      - DOCS_URL=https://docs.bioagents.io
      - DOCS_BASE_URL=/
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d docs
```

---

## Custom Domain Setup

### DNS Configuration

**For root deployment (`docs.bioagents.io`):**
```
Type: A
Name: docs
Value: <your-server-ip>
TTL: 3600
```

**For subdomain (`bioagents.io`):**
```
Type: A
Name: @
Value: <your-server-ip>
TTL: 3600
```

### SSL/TLS

Coolify automatically provisions SSL certificates via Let's Encrypt. No manual configuration needed.

For manual setup:
```bash
# Using certbot
certbot --nginx -d docs.bioagents.io
```

---

## Updating Documentation

### Via Coolify (Recommended)

1. Push changes to GitHub
2. Coolify auto-deploys on push (if enabled)
3. Or manually trigger deployment in Coolify dashboard

### Manual Update

```bash
# Rebuild and redeploy
docker-compose build docs
docker-compose up -d docs
```

---

## Health Checks

The documentation service includes health checks:

**Check health:**
```bash
# Local
curl http://localhost:3001/

# Production
curl https://docs.bioagents.io/
```

**Docker health status:**
```bash
docker ps
# Look for "healthy" status
```

---

## Monitoring

### Logs

**View logs:**
```bash
docker-compose logs -f docs
```

**In Coolify:**
- Navigate to service → Logs tab
- Real-time log streaming available

### Metrics

Nginx access and error logs are available:
```bash
docker exec bioagents-docs cat /var/log/nginx/access.log
docker exec bioagents-docs cat /var/log/nginx/error.log
```

---

## Troubleshooting

### Documentation not loading

**Check container status:**
```bash
docker ps | grep docs
docker logs bioagents-docs
```

**Verify Nginx config:**
```bash
docker exec bioagents-docs nginx -t
```

### Assets (CSS/JS) not loading

This usually happens with incorrect `baseUrl` configuration.

**Solution:**
1. Check `DOCS_BASE_URL` environment variable
2. Rebuild with correct base URL:
   ```bash
   DOCS_BASE_URL=/docs/ docker-compose build docs
   ```

### 404 errors on page refresh

This is normal for SPAs. The Nginx config handles this with:
```nginx
try_files $uri $uri/ $uri.html /index.html =404;
```

If still occurring, verify nginx.conf is properly copied in Dockerfile.

---

## Performance

The documentation is optimized for performance:

- **Build size**: ~15MB (compressed)
- **Gzip compression**: Enabled
- **Asset caching**: 1 year for static assets
- **CDN-ready**: Can be served via Cloudflare or similar

### Add CDN (Optional)

For global performance, add Cloudflare:

1. Point domain to Cloudflare nameservers
2. Enable "Proxy" (orange cloud)
3. Configure cache rules for static assets

---

## Backup

The documentation is statically generated, so backups are simple:

**Backup built files:**
```bash
docker cp bioagents-docs:/usr/share/nginx/html ./backup-docs
```

**Backup source:**
Your GitHub repository is the source of truth. Just keep it synced.

---

## Production Checklist

Before going live:

- [ ] Environment variables configured (`DOCS_URL`, `DOCS_BASE_URL`)
- [ ] Domain DNS pointing to server
- [ ] SSL/TLS certificate active
- [ ] Health checks passing
- [ ] Test all navigation links
- [ ] Test interactive API tester
- [ ] Verify search functionality
- [ ] Check mobile responsiveness
- [ ] Monitor logs for errors

---

## Support

For issues or questions:
- **GitHub Issues**: [bio-xyz/BioAgents](https://github.com/bio-xyz/BioAgents/issues)
- **Coolify Docs**: [coolify.io/docs](https://coolify.io/docs)

