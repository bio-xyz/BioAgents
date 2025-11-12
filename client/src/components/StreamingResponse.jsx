import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from './icons';

/**
 * Component to display real-time streaming response
 * Shows the finalResponse as it updates in the state
 */
export function StreamingResponse({ finalResponse }) {
  if (!finalResponse) {
    return null;
  }

  const rawHtml = marked(finalResponse);
  const sanitizedHtml = DOMPurify.sanitize(rawHtml);

  return (
    <div className="message assistant streaming">
      <div className="avatar assistant">
        <Icon name="bot" size={16} />
      </div>
      <div className="message-content-container">
        <div className="message-content-wrapper">
          <div
            className="message-content"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
          <div className="streaming-indicator">
            <span className="streaming-dot"></span>
            <span className="streaming-dot"></span>
            <span className="streaming-dot"></span>
          </div>
        </div>
      </div>
    </div>
  );
}
