import { useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from './icons';
import { Button } from './ui';

export function Message({ message }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const renderContent = () => {
    if (isUser) {
      return <div className="message-content">{message.content}</div>;
    } else {
      const rawHtml = marked(message.content);
      const sanitizedHtml = DOMPurify.sanitize(rawHtml);
      return (
        <div className="message-content-wrapper">
          <div
            className="message-content"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? 'check' : 'copy'}
            onClick={handleCopy}
            title="Copy markdown"
            className="copy-button"
          />
        </div>
      );
    }
  };

  return (
    <div className={`message ${isUser ? 'user' : 'assistant'}`}>
      <div className={`avatar ${isUser ? 'user' : 'assistant'}`}>
        <Icon name={isUser ? 'user' : 'bot'} size={16} />
      </div>
      {renderContent()}
    </div>
  );
}
