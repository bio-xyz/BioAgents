import { useState, useCallback } from 'preact/hooks';

/**
 * Get the JWT auth token for API authentication
 * Returns the JWT token issued by the server after successful login
 *
 * SECURITY NOTE:
 * - The JWT is signed by the server using BIOAGENTS_SECRET
 * - BIOAGENTS_SECRET never leaves the server
 * - Only the signed JWT token is stored on the client
 */
function getAuthToken(): string | null {
  const authToken = localStorage.getItem("bioagents_auth_token");
  if (authToken) return authToken;
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
  uploadFile: (file: File, conversationId?: string, userId?: string) => Promise<UploadedFile | null>;
  uploadFiles: (files: File[], conversationId?: string, userId?: string) => Promise<UploadedFile[]>;
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
    const authToken = getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, []);

  /**
   * Upload a single file using presigned URL flow
   */
  const uploadFile = useCallback(async (
    file: File,
    conversationId?: string,
    userId?: string
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
          userId, // Include userId for dev mode authentication
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
          userId, // Include userId for dev mode authentication
        }),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to confirm upload: ${confirmResponse.status}`);
      }

      const confirmData: ConfirmUploadResponse = await confirmResponse.json();
      console.log('[usePresignedUpload] Upload confirmed:', confirmData);

      // Return immediately - chat worker will wait for file processing
      const completedFile: UploadedFile = {
        fileId: uploadUrlData.fileId,
        filename: confirmData.filename,
        size: confirmData.size,
        status: confirmData.status, // Will be 'processing' in queue mode
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
   * Upload multiple files with fully parallel flow
   *
   * Flow:
   * 1. Get presigned URLs for ALL files in parallel
   * 2. Upload ALL files to S3 in parallel
   * 3. Confirm ALL uploads in parallel
   * 4. Poll ALL files in parallel until ready
   *
   * This maximizes parallelism for fastest possible upload
   */
  const uploadFiles = useCallback(async (
    files: File[],
    conversationId?: string,
    userId?: string
  ): Promise<UploadedFile[]> => {
    if (files.length === 0) return [];

    setIsUploading(true);
    setUploadError(null);
    console.log(`[usePresignedUpload] Starting upload of ${files.length} files`);

    try {
      // Step 1: Get presigned URLs
      // First file is sequential (may create conversation), rest are parallel
      console.log(`[usePresignedUpload] Getting presigned URLs...`);

      const getPresignedUrl = async (file: File) => {
        const response = await fetch('/api/files/upload-url', {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            conversationId,
            userId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to get upload URL for ${file.name}`);
        }

        const urlData: UploadUrlResponse = await response.json();

        // Add to state as pending
        const pendingFile: UploadedFile = {
          fileId: urlData.fileId,
          filename: file.name,
          size: file.size,
          status: 'pending',
        };
        setUploadedFiles(prev => [...prev, pendingFile]);

        return { file, urlData };
      };

      // First file sequential (creates conversation if needed)
      const firstResult = await getPresignedUrl(files[0]);
      const urlResults: { file: File; urlData: UploadUrlResponse }[] = [firstResult];

      // Remaining files in parallel (conversation now exists)
      if (files.length > 1) {
        const remainingPromises = files.slice(1).map(getPresignedUrl);
        const remainingResults = await Promise.all(remainingPromises);
        urlResults.push(...remainingResults);
      }

      console.log(`[usePresignedUpload] Got ${urlResults.length} presigned URLs`);

      // Step 2: Upload ALL files to S3 in parallel
      console.log(`[usePresignedUpload] Uploading to S3...`);
      const s3UploadPromises = urlResults.map(async ({ file, urlData }) => {
        // Update state to uploading
        setUploadedFiles(prev =>
          prev.map(f => f.fileId === urlData.fileId ? { ...f, status: 'uploading' as const } : f)
        );

        const s3Response = await fetch(urlData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        if (!s3Response.ok) {
          throw new Error(`S3 upload failed for ${file.name}: ${s3Response.status}`);
        }

        console.log(`[usePresignedUpload] S3 upload complete: ${file.name}`);
        return { file, urlData };
      });

      const s3Results = await Promise.all(s3UploadPromises);
      console.log(`[usePresignedUpload] All ${s3Results.length} files uploaded to S3`);

      // Step 3: Confirm ALL uploads in parallel
      console.log(`[usePresignedUpload] Confirming uploads...`);
      const confirmPromises = s3Results.map(async ({ file, urlData }) => {
        const confirmResponse = await fetch('/api/files/confirm', {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ fileId: urlData.fileId, userId }),
        });

        if (!confirmResponse.ok) {
          const errorData = await confirmResponse.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to confirm upload: ${file.name}`);
        }

        const confirmData: ConfirmUploadResponse = await confirmResponse.json();
        console.log(`[usePresignedUpload] Confirmed: ${file.name}, status: ${confirmData.status}`);

        // Update state to processing
        setUploadedFiles(prev =>
          prev.map(f => f.fileId === urlData.fileId ? { ...f, status: 'processing' as const } : f)
        );

        return { file, urlData, confirmData };
      });

      const confirmResults = await Promise.all(confirmPromises);
      console.log(`[usePresignedUpload] All ${confirmResults.length} uploads confirmed`);

      // Step 4: Return immediately after confirmation
      // Chat worker will wait for file processing before generating reply
      // This eliminates UI polling delay
      console.log(`[usePresignedUpload] Files confirmed, returning immediately (${new Date().toISOString()})`);
      const results = confirmResults.map(({ file, urlData, confirmData }) => {
        const completedFile: UploadedFile = {
          fileId: urlData.fileId,
          filename: confirmData.filename,
          size: confirmData.size,
          status: confirmData.status, // Will be 'processing' in queue mode
          description: confirmData.description,
        };

        setUploadedFiles(prev =>
          prev.map(f => f.fileId === urlData.fileId ? completedFile : f)
        );

        return completedFile;
      });

      console.log(`[usePresignedUpload] All uploads confirmed: ${results.length}/${files.length} (${new Date().toISOString()})`);

      setIsUploading(false);
      return results;
    } catch (error) {
      console.error('[usePresignedUpload] Upload failed:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      setIsUploading(false);
      return [];
    }
  }, [getAuthHeaders]);

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
