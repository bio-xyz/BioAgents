import { useRef, useState, useEffect } from "preact/hooks";
import { useAutoResize } from "../hooks";
import { Icon } from "./icons";

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  selectedFile,
  selectedFiles,
  onFileSelect,
  onFileRemove,
  onModeChange,
  defaultMode = "deep", // Default to deep research mode
  conversationMode, // Mode detected from existing conversation
  isNewConversation = true, // Whether this is a new conversation (no messages yet)
}) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const textareaRef = useAutoResize(value, 1, 8);
  // Use conversation mode if set (for existing conversations), otherwise use default
  const [mode, setMode] = useState(conversationMode || defaultMode);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);

  // Update mode when conversationMode changes (switching between conversations)
  useEffect(() => {
    if (conversationMode) {
      setMode(conversationMode);
    } else {
      // Reset to default for new conversations
      setMode(defaultMode);
    }
  }, [conversationMode, defaultMode]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(mode);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
    setShowUploadMenu(false);
  };

  const handleFolderClick = () => {
    folderInputRef.current?.click();
    setShowUploadMenu(false);
  };

  const selectMode = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    if (onModeChange) {
      onModeChange(newMode);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    console.log('[ChatInput] handleFileChange - files received:', files.length, files.map(f => f.name));
    processFiles(files);
    // Reset file input to allow selecting the same file again
    e.target.value = "";
  };

  const processFiles = (files) => {
    console.log('[ChatInput] processFiles - input files:', files.length);
    if (files.length === 0) {
      console.log('[ChatInput] processFiles - no files to process');
      return;
    }

    // Filter out unsupported files and hidden files
    const supportedExtensions = ['.xlsx', '.xls', '.csv', '.md', '.json', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    const filteredFiles = files.filter(file => {
      // Skip hidden files (starting with .)
      if (file.name.startsWith('.')) {
        console.log('[ChatInput] processFiles - skipping hidden file:', file.name);
        return false;
      }
      // Check extension
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const isSupported = supportedExtensions.includes(ext);
      if (!isSupported) {
        console.log('[ChatInput] processFiles - unsupported extension:', file.name, ext);
      }
      return isSupported;
    });

    console.log('[ChatInput] processFiles - filtered files:', filteredFiles.length);

    if (filteredFiles.length === 0 && files.length > 0) {
      // All files were filtered out - notify user
      alert(`No supported files found. Supported formats: ${supportedExtensions.join(', ')}`);
      return;
    }

    if (filteredFiles.length > 0) {
      if (filteredFiles.length === 1) {
        onFileSelect(filteredFiles[0]);
      } else {
        onFileSelect(filteredFiles);
      }
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    const files = [];

    // Process all items (handles both files and folders)
    const processEntry = async (entry) => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file) => {
            files.push(file);
            resolve();
          });
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        return new Promise((resolve) => {
          const readEntries = () => {
            reader.readEntries(async (entries) => {
              if (entries.length === 0) {
                resolve();
              } else {
                for (const subEntry of entries) {
                  await processEntry(subEntry);
                }
                readEntries(); // Continue reading (directories can have >100 entries)
              }
            });
          };
          readEntries();
        });
      }
    };

    // Use webkitGetAsEntry for folder support
    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) {
        promises.push(processEntry(entry));
      }
    }

    await Promise.all(promises);
    processFiles(files);
  };

  const filesToDisplay =
    selectedFiles && selectedFiles.length > 0
      ? selectedFiles
      : selectedFile
        ? [selectedFile]
        : [];
  const hasFiles = filesToDisplay.length > 0;

  // Format file size
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get total size
  const totalSize = filesToDisplay.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <div
      className={`input-container ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="drag-overlay">
          <Icon name="upload" size={32} />
          <span>Drop files or folders here</span>
        </div>
      )}

      <div className="input-wrapper">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            value={value}
            onInput={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
          />

          {hasFiles && (
            <div className="file-preview-inline">
              <div className="file-preview-header">
                <span className="file-count">
                  {filesToDisplay.length} file{filesToDisplay.length !== 1 ? 's' : ''}
                  <span className="file-total-size">({formatSize(totalSize)})</span>
                </span>
                <button
                  onClick={() => filesToDisplay.forEach((_, i) => onFileRemove(i))}
                  className="clear-all-files"
                  title="Remove all files"
                >
                  Clear all
                </button>
              </div>
              <div className="file-chips-container">
                {filesToDisplay.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="file-chip">
                    <Icon name="file" size={14} />
                    <span className="file-name" title={file.name}>
                      {file.name.length > 25
                        ? file.name.substring(0, 22) + "..."
                        : file.name}
                    </span>
                    <span className="file-size">{formatSize(file.size)}</span>
                    <button
                      onClick={() => onFileRemove(index)}
                      className="file-remove-inline"
                      title="Remove file"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="input-action-buttons">
            <div className="upload-button-container">
              <button
                onClick={() => setShowUploadMenu(!showUploadMenu)}
                disabled={disabled}
                className="input-action-btn"
                title="Add files or folder"
              >
                <Icon name="plus" size={16} />
                <span>Add</span>
                <Icon name="chevronDown" size={12} />
              </button>
              {showUploadMenu && (
                <div className="upload-menu">
                  <button onClick={handleFileClick} className="upload-menu-item">
                    <Icon name="file" size={16} />
                    <span>Upload files</span>
                  </button>
                  <button onClick={handleFolderClick} className="upload-menu-item">
                    <Icon name="folder" size={16} />
                    <span>Upload folder</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mode Switcher - Only show for new conversations */}
            {isNewConversation ? (
              <div className="mode-switcher">
                <button
                  onClick={() => selectMode("normal")}
                  disabled={disabled}
                  className={`mode-option ${mode === "normal" ? "mode-option-active" : ""}`}
                  title="Normal chat mode"
                >
                  <Icon name="messageSquare" size={14} />
                  <span>Chat</span>
                </button>
                <button
                  onClick={() => selectMode("deep")}
                  disabled={disabled}
                  className={`mode-option ${mode === "deep" ? "mode-option-active" : ""}`}
                  title="Deep research - Comprehensive research with literature gathering and hypothesis generation"
                >
                  <Icon name="globe" size={14} />
                  <span>Deep Research</span>
                </button>
              </div>
            ) : (
              <div className="mode-indicator" title={mode === "deep" ? "Deep Research mode" : "Chat mode"}>
                <Icon name={mode === "deep" ? "globe" : "messageSquare"} size={14} />
                <span>{mode === "deep" ? "Deep Research" : "Chat"}</span>
              </div>
            )}

            <button
              onClick={() => onSend(mode)}
              disabled={disabled || (!value.trim() && !hasFiles)}
              className="input-send-btn"
              title="Send message"
            >
              <Icon name="send" size={16} />
              <span>{mode === "deep" ? "Start Research" : "Send"}</span>
            </button>
          </div>
        </div>

        {/* File input for multiple files */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
          accept=".xlsx,.xls,.csv,.md,.json,.txt,.pdf,.png,.jpg,.jpeg,.webp"
        />

        {/* Folder input */}
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory={true}
          directory={true}
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {/* Click outside to close upload menu */}
      {showUploadMenu && (
        <div
          className="upload-menu-backdrop"
          onClick={() => setShowUploadMenu(false)}
        />
      )}
    </div>
  );
}
