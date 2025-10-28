import { useRef } from 'preact/hooks';
import { Icon } from './icons';
import { IconButton } from './ui';
import { useAutoResize } from '../hooks';

export function ChatInput({ value, onChange, onSend, disabled, placeholder, selectedFile, selectedFiles, onFileSelect, onFileRemove }) {
  const fileInputRef = useRef(null);
  const textareaRef = useAutoResize(value, 1, 8);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      // If only one file, use legacy single file API
      if (files.length === 1) {
        onFileSelect(files[0]);
      } else {
        // Multiple files selected
        onFileSelect(files);
      }
    }
    // Reset file input to allow selecting the same file again
    e.target.value = '';
  };

  const filesToDisplay = selectedFiles && selectedFiles.length > 0 ? selectedFiles : (selectedFile ? [selectedFile] : []);
  const hasFiles = filesToDisplay.length > 0;

  return (
    <div className="input-container">
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
              {filesToDisplay.map((file, index) => (
                <div key={`${file.name}-${index}`} className="file-chip">
                  <Icon name="file" size={14} />
                  <span className="file-name" title={file.name}>
                    {file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name}
                  </span>
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
          )}

          <div className="input-action-buttons">
            <button
              onClick={handleFileClick}
              disabled={disabled}
              className="input-action-btn"
              title="Add file"
            >
              <Icon name="plus" size={16} />
              <span>Add file</span>
            </button>
            <button
              disabled={true}
              className="input-action-btn input-action-btn-disabled"
              title="Deep search"
            >
              <Icon name="globe" size={16} />
              <span>Deep search</span>
            </button>
            <button
              disabled={true}
              className="input-action-btn input-action-btn-disabled"
              title="Think"
            >
              <Icon name="lightbulb" size={16} />
              <span>Think</span>
            </button>
            <button
              onClick={onSend}
              disabled={disabled || (!value.trim() && !hasFiles)}
              className="input-send-btn"
              title="Send message"
            >
              <Icon name="send" size={16} />
              <span>Send</span>
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept=".xlsx,.xls,.csv,.md,.json,.txt,.pdf,.png,.jpg,.jpeg,.webp"
        />
      </div>
    </div>
  );
}
