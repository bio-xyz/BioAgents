import { Icon } from './icons/Icon';

export function TypingIndicator() {
  return (
    <div className="message assistant">
      <div className="avatar assistant">
        <Icon name="bot" size={16} />
      </div>
      <div className="message-content">
        <div className="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}
