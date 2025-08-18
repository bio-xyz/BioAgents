import { Plugin } from '@elizaos/core';
import { LangfuseService } from './langfuse-service';

export const langfusePlugin: Plugin = {
    name: 'langfuse',
    description: 'Advanced Langfuse tracing with runtime-based model detection and cost tracking',
    services: [LangfuseService],
    actions: [],
    evaluators: [],
    providers: [],
};

// Export LangfuseService for external use
export { LangfuseService } from './langfuse-service';

export default langfusePlugin;

/*
 * 🚀 Langfuse Plugin Usage Example:
 * 
 * The plugin automatically extracts user IDs from model calls. 
 * Actions can pass user context to ensure accurate tracking:
 * 
 * ```typescript
 * // In your action handler:
 * const response = await runtime.useModel(ModelType.TEXT_LARGE, {
 *     prompt: "Hello, how can I help?",
 *     entityId: message.entityId,    // ✅ Pass user ID
 *     roomId: message.roomId,        // ✅ Pass room ID
 *     temperature: 0.7
 * });
 * ```
 * 
 * The plugin will automatically track:
 * - User ID (from message.entityId)
 * - Room ID (for session grouping)
 * - Actual model names (gpt-4, claude-3-5-sonnet, etc.)
 * - Token usage and costs
 * - Response times and performance
 */ 