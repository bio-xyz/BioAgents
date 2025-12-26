/**
 * Artifact and figure download utilities for paper generation
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../../../utils/logger";
import { getStorageProvider } from "../../../storage";
import { sanitizeFilename } from "./escapeLatex";
import type { AnalysisArtifact, PlanTask } from "../../../types/core";
import type { FigureInfo } from "../types";

/**
 * Download artifacts from analysis tasks and prepare them as figures
 */
export async function downloadDiscoveryFigures(
  allowedTasks: PlanTask[],
  discoveryIndex: number,
  figuresDir: string,
  userId: string,
  conversationStateId: string,
): Promise<FigureInfo[]> {
  const figures: FigureInfo[] = [];

  // Only process ANALYSIS tasks with artifacts
  const analysisTasks = allowedTasks.filter(
    (task) => task.type === "ANALYSIS" && task.artifacts && task.artifacts.length > 0,
  );

  logger.info(
    {
      discoveryIndex,
      totalTasks: allowedTasks.length,
      analysisTasks: analysisTasks.length,
    },
    "downloading_discovery_figures",
  );

  for (const task of analysisTasks) {
    if (!task.artifacts) continue;

    logger.info(
      {
        taskId: task.id,
        jobId: task.jobId,
        artifactCount: task.artifacts.length,
      },
      "processing_task_artifacts",
    );

    for (const artifact of task.artifacts) {
      // Only download FILE artifacts (not FOLDER)
      if (artifact.type !== "FILE") {
        logger.debug(
          { artifactName: artifact.name, type: artifact.type },
          "skipping_non_file_artifact",
        );
        continue;
      }

      // Only download image files (png, jpg, jpeg, svg, pdf)
      const ext = getFileExtension(artifact.name || artifact.path || "");
      if (!isImageExtension(ext)) {
        logger.debug(
          { artifactName: artifact.name, ext },
          "skipping_non_image_artifact",
        );
        continue;
      }

      logger.info(
        {
          artifactId: artifact.id,
          artifactName: artifact.name,
          artifactPath: artifact.path,
          taskId: task.id,
        },
        "attempting_to_download_artifact",
      );

      try {
        const figureInfo = await downloadArtifact(
          artifact,
          task,
          discoveryIndex,
          figuresDir,
          userId,
          conversationStateId,
        );
        if (figureInfo) {
          figures.push(figureInfo);
          logger.info(
            {
              filename: figureInfo.filename,
              sourceJobId: figureInfo.sourceJobId,
            },
            "artifact_successfully_added_as_figure",
          );
        }
      } catch (error) {
        logger.warn(
          {
            artifactId: artifact.id,
            artifactName: artifact.name,
            artifactPath: artifact.path,
            taskId: task.id,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          "artifact_download_failed_continuing_without_figure",
        );
        // Continue with other artifacts - don't fail entire paper generation
      }
    }
  }

  logger.info(
    { discoveryIndex, figureCount: figures.length },
    "figures_downloaded",
  );

  return figures;
}

/**
 * Download a single artifact and save it with a stable filename
 */
async function downloadArtifact(
  artifact: AnalysisArtifact,
  task: PlanTask,
  discoveryIndex: number,
  figuresDir: string,
  userId: string,
  conversationStateId: string,
): Promise<FigureInfo | null> {
  let artifactPath = artifact.path;
  if (!artifactPath) {
    logger.warn(
      { artifactId: artifact.id, artifactName: artifact.name },
      "artifact_missing_path_skipping",
    );
    return null;
  }

  // Transform paths that start with "task/" to include full S3 path
  // Format: user/{userId}/conversation/{conversationStateId}/task/...
  if (artifactPath.startsWith("task/")) {
    const originalPath = artifactPath;
    artifactPath = `user/${userId}/conversation/${conversationStateId}/${artifactPath}`;
    logger.info(
      {
        originalPath,
        transformedPath: artifactPath,
        conversationStateId,
      },
      "transformed_artifact_path_for_conversation_state",
    );
  }

  logger.debug(
    {
      artifactPath,
      isUrl: artifactPath.startsWith("http"),
      discoveryIndex,
    },
    "starting_artifact_download",
  );

  // Determine original filename
  const originalName = artifact.name || path.basename(artifactPath);
  const ext = getFileExtension(originalName);

  // Create stable filename: d{discoveryIndex}_{sanitizedName}.{ext}
  const sanitizedName = sanitizeFilename(originalName);
  const stableFilename = `d${discoveryIndex}_${sanitizedName}`;

  const localPath = path.join(figuresDir, stableFilename);

  // Download artifact
  let buffer: Buffer;

  if (artifactPath.startsWith("http://") || artifactPath.startsWith("https://")) {
    // Download from HTTP(S) URL
    logger.info({ url: artifactPath }, "downloading_artifact_from_url");
    buffer = await downloadFromURL(artifactPath);
  } else {
    // Download from storage using key
    logger.info({ key: artifactPath }, "downloading_artifact_from_storage");
    buffer = await downloadFromStorage(artifactPath);
  }

  // Save to local path
  fs.writeFileSync(localPath, buffer);

  logger.info(
    {
      artifactPath,
      stableFilename,
      size: buffer.length,
    },
    "artifact_downloaded",
  );

  // Prepare caption seed
  const captionSeed = artifact.description || `Figure from task ${task.jobId || task.id}`;

  return {
    filename: stableFilename,
    captionSeed,
    sourceJobId: task.jobId || task.id || "unknown",
    originalPath: artifactPath,
  };
}

/**
 * Download artifact from HTTP(S) URL
 */
async function downloadFromURL(url: string): Promise<Buffer> {
  logger.info({ url }, "downloading_artifact_from_url");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download artifact from ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download artifact from storage provider (S3/R2/etc.)
 */
async function downloadFromStorage(key: string): Promise<Buffer> {
  const storage = getStorageProvider();

  if (!storage) {
    // Fallback: try using ARTIFACT_BASE_URL if available
    const artifactBaseUrl = process.env.ARTIFACT_BASE_URL;
    if (artifactBaseUrl) {
      const url = `${artifactBaseUrl}/${key}`;
      logger.info({ key, url, fallback: true }, "using_artifact_base_url_fallback");
      return await downloadFromURL(url);
    }

    const errorMsg = "Storage provider not available and ARTIFACT_BASE_URL not configured";
    logger.error({ key }, errorMsg);
    throw new Error(`${errorMsg}. Cannot download artifact: ${key}`);
  }

  logger.debug({ key, bucket: process.env.S3_BUCKET }, "attempting_storage_download");

  try {
    const buffer = await storage.download(key);
    logger.info(
      { key, size: buffer.length },
      "storage_download_successful",
    );
    return buffer;
  } catch (error: any) {
    logger.error(
      {
        key,
        errorName: error?.name,
        errorCode: error?.$metadata?.httpStatusCode,
        errorMessage: error?.message,
      },
      "storage_download_failed",
    );
    throw error;
  }
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match && match[1] ? match[1].toLowerCase() : "";
}

/**
 * Check if file extension is an image format
 */
function isImageExtension(ext: string): boolean {
  const imageExtensions = ["png", "jpg", "jpeg", "svg", "pdf", "gif", "webp"];
  return imageExtensions.includes(ext.toLowerCase());
}
