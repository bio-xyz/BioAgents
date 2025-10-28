import { query } from "@anthropic-ai/claude-agent-sdk";

interface SkillResult {
  type: string;
  subtype?: string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
    server_tool_use?: {
      web_search_requests: number;
    };
    service_tier: string;
    cache_creation?: {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    };
  };
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
  }>;
  permission_denials: any[];
  uuid: string;
}

export async function callAnthropicWithSkills(prompt: string): Promise<SkillResult | null> {
  let lastMessage: any = null;

  for await (const message of query({
    prompt,
    options: {
      settingSources: ["project"], // Load Skills from filesystem
      allowedTools: ["Skill", "Read", "Grep", "Bash"], // Enable Skill tool
    },
  })) {
    // Store each message, the last one will be the result
    lastMessage = message;
  }

  // Return the final result message with all metadata
  if (lastMessage?.type === "result") {
    return lastMessage as SkillResult;
  }

  return null;
}
