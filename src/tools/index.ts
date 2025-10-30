import type { Tool } from "../types/core";
import { readdirSync } from "node:fs";
import { join } from "node:path";

class ToolRegistry {
  private tools: Map<string, Tool>;

  constructor() {
    this.tools = new Map();
  }

  async registerTools() {
    const toolsDir = join(import.meta.dir);
    const entries = readdirSync(toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const toolName = entry.name;

      try {
        const toolPath = join(toolsDir, toolName, "index.ts");
        const module = await import(toolPath);

        // Look for exported tool (could be named {toolName}Tool or just tool)
        const tool = module[`${toolName}Tool`] || module.tool || module.default;

        if (tool && typeof tool === "object" && "name" in tool && "execute" in tool) {
          // Check if tool is enabled (default to true if not specified)
          const isEnabledInTool = tool.enabled !== false;

          // Check environment variable override (e.g., TOOL_PLANNING_ENABLED=false)
          const envKey = `TOOL_${tool.name.toUpperCase().replace(/-/g, "_")}_ENABLED`;
          const envValue = process.env[envKey];
          const isEnabledByEnv = envValue === undefined ? isEnabledInTool : envValue === "true";

          if (isEnabledByEnv) {
            this.tools.set(tool.name, tool as Tool);
            console.log(`Registered tool: ${tool.name}`);
          } else {
            console.log(`Skipped disabled tool: ${tool.name}`);
          }
        }
      } catch (error) {
        console.warn(`Failed to load tool ${toolName}:`, error);
      }
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

// Create singleton instance
const registry = new ToolRegistry();

// Initialize the registry
await registry.registerTools();

// Export the initialized registry
export const toolRegistry = registry;

// Export convenience methods
export const getTool = (name: string) => toolRegistry.getTool(name);
export const getAllTools = () => toolRegistry.getAllTools();
export const getToolNames = () => toolRegistry.getToolNames();
export const hasTool = (name: string) => toolRegistry.hasTool(name);
