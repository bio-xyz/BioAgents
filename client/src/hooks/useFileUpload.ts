import { useState } from 'preact/hooks';

export interface UseFileUploadReturn {
  selectedFile: File | null;
  selectFile: (file: File) => void;
  removeFile: () => void;
  clearFile: () => void;
}

/**
 * Custom hook for file upload handling
 * Manages file selection and removal
 */
export function useFileUpload(): UseFileUploadReturn {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  /**
   * Handle file selection
   */
  const selectFile = (file: File) => {
    setSelectedFile(file);
  };

  /**
   * Remove selected file
   */
  const removeFile = () => {
    setSelectedFile(null);
  };

  /**
   * Clear file after successful upload
   */
  const clearFile = () => {
    setSelectedFile(null);
  };

  return {
    selectedFile,
    selectFile,
    removeFile,
    clearFile,
  };
}
