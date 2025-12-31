# BioAgents Documentation

This documentation is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
bun install
```

## Local Development

```bash
bun run start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
bun run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Serve Built Site

```bash
bun run serve
```

This serves the built documentation locally. Search functionality is only available in the built version.

## Structure

```
documentation/
├── content/           # Docusaurus documentation (rendered site)
│   ├── getting-started/
│   ├── guides/
│   ├── architecture/
│   └── deployment/
├── docs/              # Reference documentation
│   ├── AUTH.md
│   ├── CLAUDE.md
│   ├── FILE_UPLOAD.md
│   ├── JOB_QUEUE.md
│   └── SETUP.md
├── src/
│   └── css/          # Custom styling
├── static/           # Static assets (images, etc.)
├── docusaurus.config.ts
└── sidebars.ts
```

## Deployment

Using SSH:

```bash
USE_SSH=true bun run deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> bun run deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
