#!/usr/bin/env bun

/**
 * Build script for the Preact UI
 * Bundles all dependencies and outputs to client/dist/
 * Supports watch mode with --watch flag
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, watch } from 'fs';
import { join } from 'path';

const clientDir = import.meta.dir;
const distDir = join(clientDir, 'dist');
const isWatchMode = process.argv.includes('--watch');

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

async function build() {
  const startTime = Date.now();
  console.log('🔨 Building Preact UI...');

  // Bundle JavaScript
  const buildResult = await Bun.build({
    entrypoints: [join(clientDir, 'src/index.jsx')],
    outdir: distDir,
    minify: !isWatchMode, // Don't minify in watch mode for faster builds
    target: 'browser',
    sourcemap: 'external',
    splitting: true, // Enable code splitting for better HMR
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

  // Find the CSS output file
  const cssOutput = buildResult.outputs.find(output => output.path.endsWith('.css'));
  if (cssOutput) {
    const cssFileName = cssOutput.path.split('/').pop();
    // Inject CSS link before closing </head>
    htmlContent = htmlContent.replace('</head>', `    <link rel="stylesheet" href="./${cssFileName}">\n</head>`);
  }

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
