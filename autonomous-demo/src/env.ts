// Load .env file from autonomous-demo directory
// This must be imported FIRST before any other modules

import { join } from "path";
import { readFileSync } from "fs";

const envPath = join(import.meta.dir, "../.env");

try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        process.env[key] = value;
      }
    }
  }
  console.log(`[env] Loaded from ${envPath}`);
  console.log(`[env] DEMO_PORT = ${process.env.DEMO_PORT}`);
} catch (e) {
  console.log(`[env] No .env file found at ${envPath}, using defaults`);
}
