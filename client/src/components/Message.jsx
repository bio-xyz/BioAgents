import { useState } from "preact/hooks";
import { Icon } from "./icons";
import { InlineCitationText } from "./InlineCitationText";
import { ThinkingSteps } from "./ThinkingSteps";

export function Message({ message }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getFileIcon = (mimeType) => {
    if (!mimeType) return "file";
    if (mimeType.includes("pdf")) return "file";
    if (mimeType.includes("image")) return "image";
    if (
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel") ||
      mimeType.includes("csv")
    )
      return "file";
    return "file";
  };

  const getArtifacts = () => {
    if (!message.thinkingState?.dataAnalysisResults) return [];

    const artifacts = [];
    message.thinkingState.dataAnalysisResults.forEach((result) => {
      if (result.artifacts && Array.isArray(result.artifacts)) {
        artifacts.push(...result.artifacts);
      }
    });
    return artifacts;
  };

  const isImageFile = (filename) => {
    const imageExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".bmp",
      ".webp",
      ".svg",
    ];
    return imageExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
  };

  const handleDownloadArtifact = (artifact) => {
    try {
      // Decode base64 content
      const binaryString = atob(artifact.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create blob and download
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download artifact:", err);
    }
  };

  const renderContent = () => {
    if (isUser) {
      return (
        <div className="message-content-wrapper">
          {message.files && message.files.length > 0 && (
            <div className="message-files">
              {message.files.map((file, index) => (
                <div key={index} className="message-file-badge">
                  <Icon name={getFileIcon(file.mimeType)} size={14} />
                  <span className="file-name">
                    {file.name || file.filename}
                  </span>
                  {file.size && (
                    <span className="file-size">
                      {formatFileSize(file.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="message-content">{message.content}</div>
        </div>
      );
    } else {
      const artifacts = getArtifacts();
      const hasArtifacts = artifacts.length > 0;

      return (
        <div className="message-content-wrapper">
          {/* Use InlineCitationText component for citation support */}
          <InlineCitationText content={message.content} />

          {/* Show artifacts if available */}
          {hasArtifacts && (
            <div className="message-artifacts">
              <button
                className="artifacts-header"
                onClick={() => setArtifactsCollapsed(!artifactsCollapsed)}
              >
                <Icon name="file" size={16} />
                <span>Generated Files ({artifacts.length})</span>
                <Icon
                  name="chevronDown"
                  size={16}
                  className={`artifacts-chevron ${!artifactsCollapsed ? "expanded" : ""}`}
                />
              </button>
              {!artifactsCollapsed && (
                <div className="artifacts-list">
                  {artifacts.map((artifact, index) => {
                    const isImage = isImageFile(artifact.filename);
                    return (
                      <div key={artifact.id || index} className="artifact-item">
                        <div className="artifact-info">
                          <Icon name={isImage ? "image" : "file"} size={16} />
                          <div className="artifact-details">
                            <span className="artifact-filename">
                              {artifact.filename}
                            </span>
                            {artifact.description && (
                              <span className="artifact-description">
                                {artifact.description}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDownloadArtifact(artifact)}
                            className="artifact-download-btn"
                            title="Download"
                          >
                            <Icon name="download" size={16} />
                          </button>
                        </div>
                        {isImage && (
                          <div className="artifact-preview">
                            <img
                              src={`data:image/${artifact.filename.split(".").pop()};base64,${artifact.content}`}
                              alt={artifact.description || artifact.filename}
                              onError={(e) => {
                                console.error(
                                  "Failed to load image:",
                                  artifact.filename,
                                );
                                e.target.style.display = "none";
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Show thinking steps for assistant messages that have them */}
          {message.thinkingState &&
            message.thinkingState.steps &&
            Object.keys(message.thinkingState.steps).length > 0 && (
              <div className="message-thinking-steps">
                <ThinkingSteps state={message.thinkingState} />
              </div>
            )}
          <div className="message-actions">
            <button
              onClick={handleCopy}
              className="message-action-icon-btn"
              title="Copy"
            >
              <Icon name={copied ? "check" : "copy"} size={18} />
            </button>
            <button
              disabled
              className="message-action-icon-btn message-action-disabled"
              title="Like"
            >
              <Icon name="thumbsUp" size={18} />
            </button>
            <button
              disabled
              className="message-action-icon-btn message-action-disabled"
              title="Dislike"
            >
              <Icon name="thumbsDown" size={18} />
            </button>
            <button
              disabled
              className="message-action-icon-btn message-action-disabled"
              title="Share"
            >
              <Icon name="share" size={18} />
            </button>
            <button
              disabled
              className="message-action-icon-btn message-action-disabled"
              title="Regenerate"
            >
              <Icon name="refresh" size={18} />
            </button>
            <button
              disabled
              className="message-action-icon-btn message-action-disabled"
              title="More"
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        </div>
      );
    }
  };

  // Debug: log message to see if thinkingState is present
  if (!isUser && message.thinkingState) {
    console.log(
      "[Message] Rendering with thinkingState:",
      message.thinkingState,
    );
  } else if (!isUser) {
    console.log(
      "[Message] No thinkingState for assistant message:",
      message.id,
    );
  }

  return (
    <div className={`message ${isUser ? "user" : "assistant"}`}>
      <div className={`avatar ${isUser ? "user" : "assistant"}`}>
        <Icon name={isUser ? "user" : "bot"} size={16} />
      </div>
      <div className="message-content-container">{renderContent()}</div>
    </div>
  );
}
