import * as fs from "fs";
import * as path from "path";
import logger from "../../../utils/logger";
import { getStorageProvider } from "../../../storage";
import { sanitizeFilename } from "./escapeLatex";
import type { AnalysisArtifact, PlanTask } from "../../../types/core";
import type { FigureInfo } from "../types";

export async function downloadDiscoveryFigures(
  allowedTasks: PlanTask[],
  discoveryIndex: number,
  figuresDir: string,
  userId: string,
  conversationStateId: string,
): Promise<FigureInfo[]> {
  const figures: FigureInfo[] = [];
  const analysisTasks = allowedTasks.filter(
    (task) => task.type === "ANALYSIS" && task.artifacts && task.artifacts.length > 0,
  );

  logger.info({ discoveryIndex, analysisTasks: analysisTasks.length }, "downloading_figures");

  for (const task of analysisTasks) {
    if (!task.artifacts) continue;

    for (const artifact of task.artifacts) {
      if (artifact.type !== "FILE") continue;

      const ext = getFileExtension(artifact.name || artifact.path || "");
      if (!isImageExtension(ext)) continue;

      try {
        const figureInfo = await downloadArtifact(
          artifact,
          task,
          discoveryIndex,
          figuresDir,
          userId,
          conversationStateId,
        );
        if (figureInfo) figures.push(figureInfo);
      } catch (error) {
        logger.warn(
          {
            artifactId: artifact.id,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          "artifact_download_failed",
        );
      }
    }
  }

  logger.info({ discoveryIndex, figureCount: figures.length }, "figures_downloaded");
  return figures;
}

async function downloadArtifact(
  artifact: AnalysisArtifact,
  task: PlanTask,
  discoveryIndex: number,
  figuresDir: string,
  userId: string,
  conversationStateId: string,
): Promise<FigureInfo | null> {
  let artifactPath = artifact.path;
  if (!artifactPath) return null;

  if (artifactPath.startsWith("task/")) {
    artifactPath = `user/${userId}/conversation/${conversationStateId}/${artifactPath}`;
  }

  const originalName = artifact.name || path.basename(artifactPath);
  const sanitizedName = sanitizeFilename(originalName);
  const stableFilename = `d${discoveryIndex}_${sanitizedName}`;
  const localPath = path.join(figuresDir, stableFilename);

  const buffer = artifactPath.startsWith("http://") || artifactPath.startsWith("https://")
    ? await downloadFromURL(artifactPath)
    : await downloadFromStorage(artifactPath);

  fs.writeFileSync(localPath, buffer);

  const captionSeed = artifact.description || `Figure from task ${task.jobId || task.id}`;

  return {
    filename: stableFilename,
    captionSeed,
    sourceJobId: task.jobId || task.id || "unknown",
    originalPath: artifactPath,
  };
}

async function downloadFromURL(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download from ${url}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function downloadFromStorage(key: string): Promise<Buffer> {
  const storage = getStorageProvider();

  if (!storage) {
    const artifactBaseUrl = process.env.ARTIFACT_BASE_URL;
    if (artifactBaseUrl) {
      return await downloadFromURL(`${artifactBaseUrl}/${key}`);
    }
    throw new Error("Storage provider not available and ARTIFACT_BASE_URL not configured");
  }

  try {
    return await storage.download(key);
  } catch (error: any) {
    logger.error({ key, error: error?.message }, "storage_download_failed");
    throw error;
  }
}

function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() || "";
}

/**
 * Check if a file extension is a supported image format for LLM vision.
 * Supported formats per Claude docs: image/jpeg, image/png, image/gif, image/webp
 * Note: SVG and PDF are excluded - they are not supported by vision models.
 */
function isImageExtension(ext: string): boolean {
  const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp"];
  return imageExtensions.includes(ext.toLowerCase());
}
