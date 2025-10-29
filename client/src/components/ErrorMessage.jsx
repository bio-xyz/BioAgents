import { AlertCircle, AlertTriangle, Info, X } from 'lucide-preact';

export function ErrorMessage({ message, onClose, type = 'error' }) {
  const icons = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const Icon = icons[type] || icons.error;

  return (
    <div className={`toast-message toast-${type} show`}>
      <div className="toast-content">
        <div className="toast-icon">
          <Icon size={20} />
        </div>
        <div className="toast-text">{message}</div>
      </div>
      {onClose && (
        <button className="toast-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
