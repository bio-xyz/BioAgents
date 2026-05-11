import { useState } from "preact/hooks";
import { InlineCitationText } from "./InlineCitationText";
import { Icon } from "./icons";

export function Message({ message }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return null;
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) return null;

    // Format: "12:34 PM" for today, "Dec 29, 12:34 PM" for other days
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString([], {
      hour: "numeric",
      hour12: true,
      minute: "2-digit",
    });

    if (isToday) {
      return timeStr;
    }

    const dateStr = date.toLocaleDateString([], {
      day: "numeric",
      month: "short",
    });
    return `${dateStr}, ${timeStr}`;
  };

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
    if (mimeType?.includes("image")) return "image";
    return "file";
  };

  const timestamp = formatTimestamp(message.timestamp);

  const renderContent = () => {
    if (isUser) {
      const files = message.files || [];
      const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
      const showCompact = files.length > 3;

      return (
        <div className="message-content-wrapper">
          {files.length > 0 && (
            <div className="message-files">
              {showCompact ? (
                // Compact view for many files
                <div className="message-file-badge message-file-summary">
                  <Icon name="folder" size={14} />
                  <span className="file-name">{files.length} files attached</span>
                  <span className="file-size">{formatFileSize(totalSize)}</span>
                </div>
              ) : (
                // Show individual files when 3 or fewer
                files.map((file) => (
                  <div
                    key={`${file.name || file.filename}-${file.size || 0}-${file.mimeType || ""}`}
                    className="message-file-badge"
                  >
                    <Icon name={getFileIcon(file.mimeType)} size={14} />
                    <span className="file-name">{file.name || file.filename}</span>
                    {file.size && <span className="file-size">{formatFileSize(file.size)}</span>}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="message-content">{message.content}</div>
          {timestamp && <div className="message-timestamp">{timestamp}</div>}
        </div>
      );
    } else {
      return (
        <div className="message-content-wrapper">
          {/* Use InlineCitationText component for citation support */}
          <InlineCitationText content={message.content} />

          <div className="message-footer">
            {timestamp && <div className="message-timestamp">{timestamp}</div>}
            <div className="message-actions">
              <button onClick={handleCopy} className="message-action-icon-btn" title="Copy">
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
        </div>
      );
    }
  };

  return (
    <div className={`message ${isUser ? "user" : "assistant"}`}>
      <div className={`avatar ${isUser ? "user" : "assistant"}`}>
        <Icon name={isUser ? "user" : "bot"} size={16} />
      </div>
      <div className="message-content-container">{renderContent()}</div>
    </div>
  );
}
