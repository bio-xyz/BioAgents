#!/usr/bin/env bun

/**
 * Build script for the Preact UI
 * Bundles all dependencies and outputs to client/dist/
 * Supports watch mode with --watch flag
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, watch } from 'fs';
import { join, resolve } from 'path';

const clientDir = import.meta.dir;
const distDir = join(clientDir, 'dist');
const isWatchMode = process.argv.includes('--watch');

// Load environment variables from parent directory's .env file
const envPath = join(clientDir, '..', '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=:#]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      process.env[key.trim()] = value.trim();
    }
  }
}

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

async function build() {
  const startTime = Date.now();
  console.log('🔨 Building Preact UI...');

  // Bundle JavaScript with React to Preact aliasing
  const buildResult = await Bun.build({
    entrypoints: [join(clientDir, 'src/index.jsx')],
    outdir: distDir,
    minify: !isWatchMode, // Don't minify in watch mode for faster builds
    target: 'browser',
    sourcemap: 'external',
    splitting: false, // Disable code splitting to avoid chunk files the server doesn't handle
    define: {
      'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
      'import.meta.env.CDP_PROJECT_ID': JSON.stringify(process.env.CDP_PROJECT_ID || 'your-project-id-here'),
    },
    plugins: [
      {
        name: 'react-to-preact-alias',
        setup(build) {
          // Get absolute paths to Preact modules
          const nodeModulesPath = resolve(clientDir, '..', 'node_modules');
          const preactCompatPath = resolve(nodeModulesPath, 'preact', 'compat', 'dist', 'compat.module.js');
          const preactJsxRuntimePath = resolve(nodeModulesPath, 'preact', 'jsx-runtime', 'dist', 'jsxRuntime.module.js');

          // Redirect all React imports to Preact compat with absolute paths
          build.onResolve({ filter: /^react$/ }, () => {
            return { path: preactCompatPath };
          });

          build.onResolve({ filter: /^react-dom$/ }, () => {
            return { path: preactCompatPath };
          });

          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => {
            return { path: preactJsxRuntimePath };
          });
        },
      },
    ],
  });

  if (!buildResult.success) {
    console.error('❌ Build failed:');
    for (const message of buildResult.logs) {
      console.error(message);
    }
    if (!isWatchMode) {
      process.exit(1);
    }
    return false;
  }

  // Copy HTML file and inject CSS link
  const htmlSource = join(clientDir, 'public/index.html');
  const htmlDest = join(distDir, 'index.html');

  let htmlContent = readFileSync(htmlSource, 'utf-8');

  // Note: CSS link is already in the HTML template with absolute path (/index.css)
  // No need to inject it here

  writeFileSync(htmlDest, htmlContent);

  const buildTime = Date.now() - startTime;
  console.log(`✅ Build complete in ${buildTime}ms!`);
  console.log(`📦 Output: ${distDir}`);
  console.log(`   - index.html`);
  for (const output of buildResult.outputs) {
    const fileName = output.path.split('/').pop();
    console.log(`   - ${fileName} (${(output.size / 1024).toFixed(0)}kb)`);
  }

  return true;
}

// Initial build
await build();

// Watch mode
if (isWatchMode) {
  console.log('\n👀 Watching for changes...\n');

  const srcDir = join(clientDir, 'src');
  const publicDir = join(clientDir, 'public');

  let rebuildTimeout: Timer | null = null;

  const triggerRebuild = () => {
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(async () => {
      console.log('\n🔄 Files changed, rebuilding...');
      await build();
    }, 100); // Debounce rebuilds by 100ms
  };

  // Watch src directory
  watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
      console.log(`📝 Changed: ${filename}`);
      triggerRebuild();
    }
  });

  // Watch public directory
  watch(publicDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
      console.log(`📝 Changed: ${filename}`);
      triggerRebuild();
    }
  });

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\n👋 Stopping watch mode...');
    process.exit(0);
  });
}
