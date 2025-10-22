import { useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from './icons';
import { Button } from './ui';

export function Message({ message }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleLike = () => {
    setLiked(!liked);
    if (disliked) setDisliked(false);
  };

  const handleDislike = () => {
    setDisliked(!disliked);
    if (liked) setLiked(false);
  };

  const handleShare = () => {
    // Share functionality placeholder
    console.log('Share message');
  };

  const handleRegenerate = () => {
    // Regenerate functionality placeholder
    console.log('Regenerate response');
  };

  const handleMore = () => {
    // More options placeholder
    console.log('More options');
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
          <div className="message-actions">
            <button
              onClick={handleCopy}
              className="message-action-icon-btn"
              title="Copy"
            >
              <Icon name={copied ? 'check' : 'copy'} size={18} />
            </button>
            <button
              onClick={handleLike}
              className={`message-action-icon-btn ${liked ? 'active' : ''}`}
              title="Like"
            >
              <Icon name="thumbsUp" size={18} />
            </button>
            <button
              onClick={handleDislike}
              className={`message-action-icon-btn ${disliked ? 'active' : ''}`}
              title="Dislike"
            >
              <Icon name="thumbsDown" size={18} />
            </button>
            <button
              onClick={handleShare}
              className="message-action-icon-btn"
              title="Share"
            >
              <Icon name="share" size={18} />
            </button>
            <button
              onClick={handleRegenerate}
              className="message-action-icon-btn"
              title="Regenerate"
            >
              <Icon name="refresh" size={18} />
            </button>
            <button
              onClick={handleMore}
              className="message-action-icon-btn"
              title="More"
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
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
