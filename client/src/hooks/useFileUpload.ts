import { useState } from 'preact/hooks';

export interface UseFileUploadReturn {
  selectedFile: File | null;
  selectedFiles: File[];
  selectFile: (file: File) => void;
  selectFiles: (files: File[]) => void;
  addFile: (file: File) => void;
  removeFile: (index?: number) => void;
  clearFile: () => void;
  clearFiles: () => void;
}

const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024; // 2GB total limit

/**
 * Custom hook for file upload handling
 * Manages file selection and removal with support for multiple files
 */
export function useFileUpload(): UseFileUploadReturn {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  /**
   * Handle single file selection (legacy support)
   */
  const selectFile = (file: File) => {
    console.log('[useFileUpload.selectFile] File selected:', file.name, file.size);
    if (file.size > MAX_TOTAL_SIZE) {
      alert(`File ${file.name} is too large. Maximum total size is 2GB.`);
      return;
    }
    setSelectedFile(file);
    setSelectedFiles([file]);
    console.log('[useFileUpload.selectFile] State updated');
  };

  /**
   * Handle multiple file selection
   */
  const selectFiles = (files: File[]) => {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    if (totalSize > MAX_TOTAL_SIZE) {
      alert(`Total file size (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)}GB) exceeds the 2GB limit.`);
      return;
    }

    setSelectedFiles(files);
    setSelectedFile(files[0] || null);
  };

  /**
   * Add a file to the existing selection
   */
  const addFile = (file: File) => {
    const currentTotalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    const newTotalSize = currentTotalSize + file.size;

    if (newTotalSize > MAX_TOTAL_SIZE) {
      alert(`Adding this file would exceed the 2GB total limit.`);
      return;
    }

    const newFiles = [...selectedFiles, file];
    setSelectedFiles(newFiles);
    setSelectedFile(newFiles[0]);
  };

  /**
   * Remove selected file at index (or all if no index)
   */
  const removeFile = (index?: number) => {
    if (index === undefined) {
      setSelectedFile(null);
      setSelectedFiles([]);
    } else {
      const newFiles = selectedFiles.filter((_, i) => i !== index);
      setSelectedFiles(newFiles);
      setSelectedFile(newFiles[0] || null);
    }
  };

  /**
   * Clear single file after successful upload (legacy)
   */
  const clearFile = () => {
    setSelectedFile(null);
    setSelectedFiles([]);
  };

  /**
   * Clear all files
   */
  const clearFiles = () => {
    setSelectedFile(null);
    setSelectedFiles([]);
  };

  return {
    selectedFile,
    selectedFiles,
    selectFile,
    selectFiles,
    addFile,
    removeFile,
    clearFile,
    clearFiles,
  };
}
