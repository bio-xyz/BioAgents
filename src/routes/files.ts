/**
 * File Upload Routes
 * Handles direct-to-S3 file uploads with presigned URLs
 *
 * Endpoints:
 * - POST /api/files/upload-url - Request presigned upload URL
 * - POST /api/files/confirm - Confirm upload and start processing
 * - GET /api/files/:fileId/status - Check file processing status
 * - DELETE /api/files/:fileId - Delete a file
 */

import { Elysia, t } from "elysia";
import { resolveAuth } from "../middleware/authResolver";
import {
  requestUploadUrl,
  confirmUpload,
  getFileStatusForUser,
  deleteFile,
} from "../services/files";
import logger from "../utils/logger";

export const filesRoute = new Elysia({ prefix: "/api/files" })
  /**
   * POST /api/files/upload-url
   * Request a presigned URL for direct S3 upload
   */
  .post(
    "/upload-url",
    async ({ body, request }) => {
      // Resolve authentication (pass body for userId in dev mode)
      const authResult = await resolveAuth(request, body);
      if (!authResult.authenticated || !authResult.userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const { filename, contentType, size, conversationId } = body;

      try {
        const result = await requestUploadUrl({
          filename,
          contentType,
          size,
          conversationId,
          userId: authResult.userId,
        });

        logger.info(
          { fileId: result.fileId, filename, userId: authResult.userId },
          "upload_url_requested",
        );

        return result;
      } catch (error) {
        logger.error({ error, filename }, "upload_url_request_failed");
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Failed to generate upload URL",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    },
    {
      body: t.Object({
        filename: t.String({ minLength: 1 }),
        contentType: t.String(),
        size: t.Number({ minimum: 1 }),
        conversationId: t.Optional(t.String()),
        userId: t.Optional(t.String()), // For dev mode authentication
      }),
    },
  )

  /**
   * POST /api/files/confirm
   * Confirm upload complete and start processing
   */
  .post(
    "/confirm",
    async ({ body, request }) => {
      // Resolve authentication (pass body for userId in dev mode)
      const authResult = await resolveAuth(request, body);
      if (!authResult.authenticated || !authResult.userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const { fileId } = body;

      try {
        const result = await confirmUpload({
          fileId,
          userId: authResult.userId,
        });

        logger.info(
          { fileId, status: result.status, userId: authResult.userId },
          "upload_confirmed",
        );

        return result;
      } catch (error) {
        // Enhanced error logging to capture non-Error objects
        const errorInfo = {
          fileId,
          errorType: error?.constructor?.name || typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
          errorString: String(error),
        };
        logger.error(errorInfo, "upload_confirm_failed");

        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error) || "Failed to confirm upload",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    },
    {
      body: t.Object({
        fileId: t.String({ minLength: 1 }),
        userId: t.Optional(t.String()), // For dev mode authentication
      }),
    },
  )

  /**
   * GET /api/files/:fileId/status
   * Check file processing status
   */
  .get(
    "/:fileId/status",
    async ({ params, request }) => {
      // Resolve authentication
      const authResult = await resolveAuth(request);
      if (!authResult.authenticated || !authResult.userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const { fileId } = params;

      try {
        const status = await getFileStatusForUser(fileId, authResult.userId);

        if (!status) {
          return new Response(
            JSON.stringify({ error: "File not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }

        return {
          fileId: status.fileId,
          status: status.status,
          filename: status.filename,
          size: status.size,
          description: status.description,
          error: status.error,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
        };
      } catch (error) {
        logger.error({ error, fileId }, "file_status_check_failed");
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Failed to get file status",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    },
    {
      params: t.Object({
        fileId: t.String({ minLength: 1 }),
      }),
    },
  )

  /**
   * DELETE /api/files/:fileId
   * Delete a file
   */
  .delete(
    "/:fileId",
    async ({ params, request }) => {
      // Resolve authentication
      const authResult = await resolveAuth(request);
      if (!authResult.authenticated || !authResult.userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const { fileId } = params;

      try {
        await deleteFile(fileId, authResult.userId);

        logger.info({ fileId, userId: authResult.userId }, "file_deleted");

        return { success: true };
      } catch (error) {
        logger.error({ error, fileId }, "file_delete_failed");
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Failed to delete file",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    },
    {
      params: t.Object({
        fileId: t.String({ minLength: 1 }),
      }),
    },
  );
