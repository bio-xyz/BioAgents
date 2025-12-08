import { Elysia } from "elysia";
import { getConversationBasePath, getStorageProvider } from "../storage";
import logger from "../utils/logger";

/**
 * Artifacts Route - Handles artifact downloads with presigned URLs
 */
export const artifactsRoute = new Elysia().get(
  "/api/artifacts/download",
  async ({ query }) => {
    const { userId, conversationStateId, path } = query;

    // Validate required parameters
    if (!userId || !conversationStateId || !path) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required parameters: userId, conversationStateId, path",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const storage = getStorageProvider();

      if (!storage) {
        return new Response(
          JSON.stringify({
            error: "Storage provider not configured",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      // Build the full path using getConversationBasePath + path
      const basePath = getConversationBasePath(userId, conversationStateId);
      const cleanPath = path.replace(/^\/+/, "");
      const fullPath = `${basePath}/${cleanPath}`;

      // Extract filename from path for Content-Disposition header
      const filename = cleanPath.split("/").pop() || "download";

      // Generate presigned URL with filename (forces download via Content-Disposition)
      const url = await storage.getPresignedUrl(fullPath, 3600, filename);

      return new Response(JSON.stringify({ url }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error(
        { userId, conversationStateId, path, error },
        "failed_to_generate_presigned_url",
      );

      return new Response(
        JSON.stringify({
          error: "Failed to generate download URL",
          details: (error as Error).message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
);
