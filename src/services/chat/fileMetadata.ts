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

export function parseUploadedFileReferences(value: unknown): UploadedFileReference[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isUploadedFileReference) : [];
  } catch {
    return [];
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
