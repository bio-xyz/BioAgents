// Bun build script for Preact client

import { watch } from "fs";
import { join } from "path";

const isWatch = process.argv.includes("--watch");

// Resolve preact/compat path for aliasing
const preactCompatPath = join(process.cwd(), "node_modules/preact/compat/dist/compat.module.js");

async function build() {
  const startTime = Date.now();

  const result = await Bun.build({
    entrypoints: ["./client/src/index.tsx"],
    outdir: "./client/dist",
    target: "browser",
    format: "esm",
    splitting: false,
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : "none",
    define: {
      "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
    },
    plugins: [
      {
        name: "preact-alias",
        setup(build) {
          // Alias react to preact/compat
          build.onResolve({ filter: /^react$/ }, () => ({
            path: preactCompatPath,
          }));
          build.onResolve({ filter: /^react-dom$/ }, () => ({
            path: preactCompatPath,
          }));
        },
      },
    ],
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Copy HTML template
  const htmlSource = Bun.file("./client/index.html");
  const htmlDest = "./client/dist/index.html";
  await Bun.write(htmlDest, htmlSource);

  // Copy CSS
  const cssSource = Bun.file("./client/src/styles.css");
  const cssDest = "./client/dist/styles.css";
  await Bun.write(cssDest, cssSource);

  const elapsed = Date.now() - startTime;
  console.log(`Build completed in ${elapsed}ms`);
}

// Initial build
await build();

// Watch mode
if (isWatch) {
  console.log("Watching for changes...");

  const srcDir = join(process.cwd(), "client/src");

  watch(srcDir, { recursive: true }, async (event, filename) => {
    if (filename && (filename.endsWith(".tsx") || filename.endsWith(".ts") || filename.endsWith(".css"))) {
      console.log(`File changed: ${filename}`);
      try {
        await build();
      } catch (error) {
        console.error("Build error:", error);
      }
    }
  });
}
