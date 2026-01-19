import { Elysia } from "elysia";
import { getConversationBasePath, getStorageProvider } from "../storage";
import { authResolver } from "../middleware/authResolver";
import type { AuthContext } from "../types/auth";
import logger from "../utils/logger";

/**
 * Artifacts Route - Handles artifact downloads with presigned URLs
 *
 * Security measures:
 * - Authentication required (JWT, API key, or x402)
 * - Ownership validation (user can only access their own artifacts)
 * - Path traversal protection (blocks ../ sequences)
 */
export const artifactsRoute = new Elysia().guard(
  {
    beforeHandle: [
      authResolver({ required: true }),
    ],
  },
  (app) =>
    app.get("/api/artifacts/download", async ({ query, request, set }) => {
      const auth = (request as any).auth as AuthContext;
      const authenticatedUserId = auth.userId;

      const { userId, conversationStateId, path } = query;

      // Validate required parameters
      if (!userId || !conversationStateId || !path) {
        set.status = 400;
        return {
          error: "Missing required parameters: userId, conversationStateId, path",
        };
      }

      // SECURITY: Verify ownership - user can only access their own artifacts
      if (userId !== authenticatedUserId) {
        logger.warn(
          {
            requestedUserId: userId,
            authenticatedUserId,
            conversationStateId,
            path,
          },
          "artifact_download_unauthorized_access_attempt"
        );
        set.status = 403;
        return {
          error: "Forbidden",
          message: "You can only access your own artifacts",
        };
      }

      // SECURITY: Block path traversal attacks
      if (path.includes("..") || path.includes("./") || path.includes("\\")) {
        logger.warn(
          { userId, conversationStateId, path },
          "artifact_download_path_traversal_attempt"
        );
        set.status = 400;
        return {
          error: "Invalid path",
          message: "Path cannot contain directory traversal sequences",
        };
      }

      try {
        const storage = getStorageProvider();

        if (!storage) {
          set.status = 503;
          return {
            error: "Storage provider not configured",
          };
        }

        // Build the full path using getConversationBasePath + path
        const basePath = getConversationBasePath(userId, conversationStateId);
        const cleanPath = path.replace(/^\/+/, "");
        const fullPath = `${basePath}/${cleanPath}`;

        // Extract filename from path for Content-Disposition header
        const filename = cleanPath.split("/").pop() || "download";

        // Generate presigned URL with filename (forces download via Content-Disposition)
        const url = await storage.getPresignedUrl(fullPath, 3600, filename);

        logger.info(
          { userId, conversationStateId, filename },
          "artifact_download_presigned_url_generated"
        );

        return { url };
      } catch (error) {
        logger.error(
          { userId, conversationStateId, path, error },
          "failed_to_generate_presigned_url"
        );

        set.status = 500;
        return {
          error: "Failed to generate download URL",
        };
      }
    })
);
