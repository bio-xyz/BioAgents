/**
 * Sanitize input parameters for Langfuse logging
 */
export function sanitizeInput(params: any): any {
    if (typeof params === 'string') return params.substring(0, 1000);
    if (params?.messages) return params.messages.slice(-3); // Last 3 messages for context
    if (params?.prompt) return params.prompt.substring(0, 1000);
    if (params?.input) return params.input.substring(0, 1000);
    return JSON.stringify(params).substring(0, 1000);
}

/**
 * Sanitize output results for Langfuse logging
 */
export function sanitizeOutput(result: any): any {
    if (typeof result === 'string') {
        return result.length > 2000 ? result.substring(0, 2000) + '...' : result;
    }

    if (typeof result === 'object' && result !== null) {
        try {
            const cleaned = { ...result };
            delete cleaned._response; // Remove large internal objects
            delete cleaned.raw; // Remove raw response data

            // Handle embedding arrays specially
            if (Array.isArray(cleaned.data) && cleaned.data.length > 0) {
                // For embeddings, just show metadata and truncate the data array
                cleaned.data = cleaned.data.slice(0, 3).map((item: any) => {
                    if (Array.isArray(item?.embedding)) {
                        return {
                            ...item,
                            embedding: `[${item.embedding.length} dimensions]`
                        };
                    }
                    return item;
                });
                if (result.data.length > 3) {
                    cleaned.data.push(`... and ${result.data.length - 3} more items`);
                }
            }

            // Handle direct embedding arrays
            if (Array.isArray(cleaned) && cleaned.length > 100) {
                return `[Array with ${cleaned.length} items: ${cleaned.slice(0, 5).join(', ')}...]`;
            }

            // Try to stringify and check size
            const str = JSON.stringify(cleaned);
            if (str.length <= 2000) {
                return cleaned;
            }

            // If too large, return a safe summary
            return {
                type: Array.isArray(result) ? 'array' : 'object',
                size: Array.isArray(result) ? result.length : Object.keys(result).length,
                keys: Array.isArray(result) ? undefined : Object.keys(result).slice(0, 10),
                sample: Array.isArray(result) ? result.slice(0, 2) : undefined,
                truncated: true,
                originalSize: str.length
            };
        } catch (error) {
            // If any error occurs during sanitization, return a safe fallback
            return {
                type: typeof result,
                error: 'Failed to sanitize output',
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    return result;
} 