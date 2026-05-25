import logger from "../../utils/logger";

export interface UploadedFileReference {
  fileId: string;
  fileKey: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: number;
}

export interface MessageFileMetadata {
  fileId?: string;
  fileKey?: string;
  name: string;
  size: number;
  type: string;
}

export function isUploadedFileReference(value: unknown): value is UploadedFileReference {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.fileId === "string" &&
    typeof raw.fileKey === "string" &&
    typeof raw.filename === "string" &&
    typeof raw.contentType === "string" &&
    typeof raw.size === "number" &&
    typeof raw.uploadedAt === "number"
  );
}

export function parseUploadedFileReferences(value: unknown): UploadedFileReference[] | null {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      logger.warn({ valueType: typeof parsed }, "parse_uploaded_file_references_invalid_shape");
      return null;
    }
    const references = parsed.filter(isUploadedFileReference);
    if (references.length !== parsed.length) {
      logger.warn(
        { invalidCount: parsed.length - references.length },
        "parse_uploaded_file_references_invalid_entry"
      );
      return null;
    }
    return references;
  } catch (err) {
    logger.warn({ err }, "parse_uploaded_file_references_invalid_json");
    return null;
  }
}

export function normalizeMessageFileMetadata(params: {
  files: File[];
  fileReferences?: UploadedFileReference[];
}): MessageFileMetadata[] | undefined {
  const rawFiles = params.files.map((f) => ({
    name: f.name,
    size: f.size,
    type: f.type,
  }));
  const referencedFiles = (params.fileReferences ?? []).map((f) => ({
    fileId: f.fileId,
    fileKey: f.fileKey,
    name: f.filename,
    size: f.size,
    type: f.contentType,
  }));
  const allFiles = [...rawFiles, ...referencedFiles];
  return allFiles.length > 0 ? allFiles : undefined;
}
