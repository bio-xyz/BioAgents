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
      {selectedFile && (
        <div className="file-preview">
          <div className="file-preview-content">
            <Icon name="file" size={16} />
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">({(selectedFile.size / 1024).toFixed(1)}KB)</span>
          </div>
          <IconButton
            icon="close"
            size={14}
            onClick={onFileRemove}
            title="Remove file"
            variant="ghost"
            className="file-remove-btn"
          />
        </div>
      )}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onInput={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
        />
        <div className="input-actions">
          <IconButton
            icon="attach"
            size={18}
            title="Attach file"
            disabled={disabled}
            onClick={handleFileClick}
            variant="ghost"
            className="attach-button"
          />
          <IconButton
            icon="send"
            size={18}
            onClick={onSend}
            disabled={disabled || (!value.trim() && !selectedFile)}
            title="Send message"
            variant="default"
            className={`send-button ${disabled ? 'loading' : ''}`}
          />
        </div>
      </div>
    </div>
  );
}
