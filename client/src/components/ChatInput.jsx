import { useRef } from 'preact/hooks';
import { Icon } from './icons';
import { IconButton } from './ui';
import { useAutoResize } from '../hooks';

export function ChatInput({ value, onChange, onSend, disabled, placeholder, selectedFile, onFileSelect, onFileRemove }) {
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
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

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

          {selectedFile && (
            <div className="file-preview-inline">
              <Icon name="file" size={14} />
              <span className="file-name">{selectedFile.name}</span>
              <button
                onClick={onFileRemove}
                className="file-remove-inline"
                title="Remove file"
              >
                <Icon name="close" size={12} />
              </button>
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
              disabled={disabled}
              className="input-action-btn"
              title="Deep search"
            >
              <Icon name="globe" size={16} />
              <span>Deep search</span>
            </button>
            <button
              disabled={disabled}
              className="input-action-btn"
              title="Think"
            >
              <Icon name="lightbulb" size={16} />
              <span>Think</span>
            </button>
            <button
              onClick={onSend}
              disabled={disabled || (!value.trim() && !selectedFile)}
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
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
        />
      </div>
    </div>
  );
}
