/**
 * MVP dummy tool: generates a random number.
 * Self-registers on import.
 */

import { z } from "zod";
import { registerTool } from "../registry";

const InputSchema = z.object({
  min: z.number().default(1),
  max: z.number().default(100),
});

registerTool({
  name: "random_number",
  description:
    "Generate a random integer between min and max (inclusive). Useful for testing or when the user asks for a random number.",
  inputSchema: {
    type: "object",
    properties: {
      min: { type: "number", description: "Minimum value (default 1)" },
      max: { type: "number", description: "Maximum value (default 100)" },
    },
    required: [],
  },
  execute: async (input) => {
    const parsed = InputSchema.parse(input);
    const lo = Math.min(parsed.min, parsed.max);
    const hi = Math.max(parsed.min, parsed.max);
    const result = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    return {
      content: JSON.stringify({ random_number: result, min, max }),
    };
  },
});
