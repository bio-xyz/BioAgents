import { useState, useCallback } from 'preact/hooks';

/**
 * Get the API secret for authentication
 */
function getApiSecret(): string | null {
  const localSecret = localStorage.getItem("bioagents_secret");
  if (localSecret) return localSecret;

  // @ts-ignore - Vite injects this at build time
  const envSecret = import.meta.env?.BIOAGENTS_SECRET;
  if (envSecret) return envSecret;

  return null;
}

export interface UploadedFile {
  fileId: string;
  filename: string;
  size: number;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
  description?: string;
  error?: string;
}

export interface UploadUrlResponse {
  fileId: string;
  uploadUrl: string;
  s3Key: string;
  expiresAt: string;
  conversationId: string;
  conversationStateId: string;
}

export interface ConfirmUploadResponse {
  fileId: string;
  status: 'ready' | 'processing';
  filename: string;
  size: number;
  description?: string;
  jobId?: string;
}

export interface UsePresignedUploadReturn {
  uploadedFiles: UploadedFile[];
  isUploading: boolean;
  uploadError: string | null;
  uploadFile: (file: File, conversationId?: string) => Promise<UploadedFile | null>;
  uploadFiles: (files: File[], conversationId?: string) => Promise<UploadedFile[]>;
  clearUploadedFiles: () => void;
  removeUploadedFile: (fileId: string) => void;
  pollFileStatus: (fileId: string) => Promise<UploadedFile | null>;
}

/**
 * Custom hook for handling presigned S3 file uploads
 *
 * Flow:
 * 1. Request presigned URL from /api/files/upload-url
 * 2. Upload file directly to S3 using presigned URL
 * 3. Confirm upload via /api/files/confirm
 * 4. Optionally poll for processing status
 */
export function usePresignedUpload(): UsePresignedUploadReturn {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Get auth headers for API requests
   */
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiSecret = getApiSecret();
    if (apiSecret) {
      headers['Authorization'] = `Bearer ${apiSecret}`;
    }
    return headers;
  }, []);

  /**
   * Upload a single file using presigned URL flow
   */
  const uploadFile = useCallback(async (
    file: File,
    conversationId?: string
  ): Promise<UploadedFile | null> => {
    setUploadError(null);

    // Create pending file entry
    const pendingFile: UploadedFile = {
      fileId: '', // Will be set after getting URL
      filename: file.name,
      size: file.size,
      status: 'pending',
    };

    try {
      // Step 1: Request presigned upload URL
      console.log('[usePresignedUpload] Requesting upload URL for:', file.name);

      const urlResponse = await fetch('/api/files/upload-url', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          conversationId,
        }),
      });

      if (!urlResponse.ok) {
        const errorData = await urlResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to get upload URL: ${urlResponse.status}`);
      }

      const uploadUrlData: UploadUrlResponse = await urlResponse.json();
      console.log('[usePresignedUpload] Got upload URL, fileId:', uploadUrlData.fileId);

      // Update file entry with fileId
      const uploadingFile: UploadedFile = {
        ...pendingFile,
        fileId: uploadUrlData.fileId,
        status: 'uploading',
      };

      setUploadedFiles(prev => [...prev, uploadingFile]);

      // Step 2: Upload file directly to S3
      console.log('[usePresignedUpload] Uploading to S3...');

      const s3Response = await fetch(uploadUrlData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!s3Response.ok) {
        throw new Error(`S3 upload failed: ${s3Response.status}`);
      }

      console.log('[usePresignedUpload] S3 upload complete');

      // Step 3: Confirm upload with backend
      console.log('[usePresignedUpload] Confirming upload...');

      const confirmResponse = await fetch('/api/files/confirm', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          fileId: uploadUrlData.fileId,
        }),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to confirm upload: ${confirmResponse.status}`);
      }

      const confirmData: ConfirmUploadResponse = await confirmResponse.json();
      console.log('[usePresignedUpload] Upload confirmed:', confirmData);

      // Update file status
      const completedFile: UploadedFile = {
        fileId: uploadUrlData.fileId,
        filename: confirmData.filename,
        size: confirmData.size,
        status: confirmData.status,
        description: confirmData.description,
      };

      setUploadedFiles(prev =>
        prev.map(f => f.fileId === uploadUrlData.fileId ? completedFile : f)
      );

      return completedFile;
    } catch (error) {
      console.error('[usePresignedUpload] Upload failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      setUploadError(errorMessage);

      // Update file status to error if we have a fileId
      if (pendingFile.fileId) {
        setUploadedFiles(prev =>
          prev.map(f => f.fileId === pendingFile.fileId
            ? { ...f, status: 'error' as const, error: errorMessage }
            : f
          )
        );
      }

      return null;
    }
  }, [getAuthHeaders]);

  /**
   * Upload multiple files
   */
  const uploadFiles = useCallback(async (
    files: File[],
    conversationId?: string
  ): Promise<UploadedFile[]> => {
    setIsUploading(true);
    setUploadError(null);

    const results: UploadedFile[] = [];

    for (const file of files) {
      const result = await uploadFile(file, conversationId);
      if (result) {
        results.push(result);
      }
    }

    setIsUploading(false);
    return results;
  }, [uploadFile]);

  /**
   * Poll for file processing status
   */
  const pollFileStatus = useCallback(async (fileId: string): Promise<UploadedFile | null> => {
    try {
      const response = await fetch(`/api/files/${fileId}/status`, {
        method: 'GET',
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to get status: ${response.status}`);
      }

      const data = await response.json();

      const fileStatus: UploadedFile = {
        fileId: data.fileId,
        filename: data.filename,
        size: data.size,
        status: data.status,
        description: data.description,
        error: data.error,
      };

      // Update in state
      setUploadedFiles(prev =>
        prev.map(f => f.fileId === fileId ? fileStatus : f)
      );

      return fileStatus;
    } catch (error) {
      console.error('[usePresignedUpload] Status poll failed:', error);
      return null;
    }
  }, [getAuthHeaders]);

  /**
   * Clear all uploaded files
   */
  const clearUploadedFiles = useCallback(() => {
    setUploadedFiles([]);
    setUploadError(null);
  }, []);

  /**
   * Remove a specific uploaded file
   */
  const removeUploadedFile = useCallback((fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.fileId !== fileId));
  }, []);

  return {
    uploadedFiles,
    isUploading,
    uploadError,
    uploadFile,
    uploadFiles,
    clearUploadedFiles,
    removeUploadedFile,
    pollFileStatus,
  };
}
