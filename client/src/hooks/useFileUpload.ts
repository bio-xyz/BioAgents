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

const MAX_FILES = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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
    if (file.size > MAX_FILE_SIZE) {
      alert(`File ${file.name} is too large. Maximum size is 5MB.`);
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
    const validFiles = files.filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File ${file.name} is too large. Maximum size is 5MB.`);
        return false;
      }
      return true;
    }).slice(0, MAX_FILES);

    if (files.length > MAX_FILES) {
      alert(`You can only upload up to ${MAX_FILES} files at once.`);
    }

    setSelectedFiles(validFiles);
    setSelectedFile(validFiles[0] || null);
  };

  /**
   * Add a file to the existing selection
   */
  const addFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert(`File ${file.name} is too large. Maximum size is 5MB.`);
      return;
    }

    if (selectedFiles.length >= MAX_FILES) {
      alert(`You can only upload up to ${MAX_FILES} files at once.`);
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
