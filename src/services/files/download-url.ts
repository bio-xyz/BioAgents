export interface DownloadableFileMetadata {
  fileId: string;
  fileKey: string;
  filename: string;
  contentType: string;
  size: number;
}

export type PersistedMessageFileMetadata = {
  fileId?: string;
  fileKey?: string;
  name: string;
  size: number;
  type: string;
};

export type DownloadableFileStatusMetadata = {
  contentType: string;
  fileId: string;
  filename: string;
  s3Key: string;
  size: number;
};

export function resolveDownloadableFileMetadata(params: {
  status: DownloadableFileStatusMetadata | null | undefined;
  persistedFile?: PersistedMessageFileMetadata | null;
}): DownloadableFileMetadata | null {
  if (params.status) {
    return {
      contentType: params.status.contentType,
      fileId: params.status.fileId,
      fileKey: params.status.s3Key,
      filename: params.status.filename,
      size: params.status.size,
    };
  }

  const persistedFile = params.persistedFile;
  if (!persistedFile?.fileId || !persistedFile.fileKey) return null;

  return {
    contentType: persistedFile.type,
    fileId: persistedFile.fileId,
    fileKey: persistedFile.fileKey,
    filename: persistedFile.name,
    size: persistedFile.size,
  };
}
