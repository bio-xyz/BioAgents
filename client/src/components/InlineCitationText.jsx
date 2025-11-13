import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseCitationsFromText, extractDomainName } from '../utils/parseCitations';

/**
 * Component that renders text with inline citations
 * Citations format: [text]{url1,url2}
 * Renders as: text[1] with hover preview
 */
export function InlineCitationText({ content }) {
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const contentRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  const { citations } = useMemo(() =>
    parseCitationsFromText(content),
    [content]
  );

  const contentWithAnchors = useMemo(() => {
    if (citations.length === 0) {
      // Use the parsed content which removes all [text]{} patterns
      const { textWithoutCitations } = parseCitationsFromText(content);
      return textWithoutCitations;
    }

    let processedContent = content;

    // Replace citation patterns: [text]{urls} -> text<anchor>
    // This also handles [text]{} -> text (no anchor, just text)
    citations.forEach((citation) => {
      const anchor = `<span data-citation-anchor="${citation.index}"></span>`;
      processedContent = processedContent.replace(
        citation.originalMatch,
        `${citation.text}${anchor}`,
      );
    });

    // Now remove any remaining [text]{} patterns that weren't in citations (empty URLs)
    // Use the same regex to clean up
    processedContent = processedContent.replace(/\[([^\]]*)\]\{([^\}]*)\}/g, '$1');

    return processedContent;
  }, [citations, content]);

  // If no citations found, render normally with cleaned content
  if (citations.length === 0) {
    const { textWithoutCitations } = parseCitationsFromText(content);
    const rawHtml = marked(textWithoutCitations);
    const sanitizedHtml = DOMPurify.sanitize(rawHtml);
    return (
      <div
        className="message-content"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  const handleCitationHover = (citation, e) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const contentContainer = contentRef.current?.getBoundingClientRect();

    if (!contentContainer) return;

    // Calculate position relative to content container
    // This keeps the hover card within the message content width
    const position = {
      x: rect.left - contentContainer.left + rect.width / 2,  // Relative to content container
      y: rect.top - contentContainer.top - 10,                // 10px above button, relative to container
    };

    setHoverPosition(position);
    setHoveredCitation(citation);
    setCurrentSourceIndex(0); // Reset to first source when hovering new citation
  };

  const handlePrevSource = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentSourceIndex > 0) {
      setCurrentSourceIndex(prev => prev - 1);
    }
  };

  const handleNextSource = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoveredCitation && currentSourceIndex < hoveredCitation.urls.length - 1) {
      setCurrentSourceIndex(prev => prev + 1);
    }
  };

  const handleCitationLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
      setHoverPosition(null);
    }, 200);
  };

  const handleCitationClick = (citation, e) => {
    e.preventDefault();
    if (citation.urls.length === 1) {
      window.open(citation.urls[0], '_blank', 'noopener,noreferrer');
    } else if (citation.urls.length > 1) {
      citation.urls.forEach(url => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // After markdown rendering, inject citation buttons inline
  useEffect(() => {
    if (!contentRef.current || citations.length === 0) return;

    citations.forEach((citation) => {
      const anchor = contentRef.current.querySelector(`[data-citation-anchor="${citation.index}"]`);
      if (!anchor) return;

      anchor.classList.add('citation-button-wrapper');
      anchor.innerHTML = '';

      const button = document.createElement('button');
      button.className = 'citation-button';
      button.textContent = `[${citation.index}]`;

      const firstUrl = citation.urls[0];
      let domainName = String(citation.index);
      try {
        domainName = extractDomainName(new URL(firstUrl).hostname);
      } catch {
        // Use index if URL parsing fails
      }

      button.title = `View source: ${domainName}${citation.urls.length > 1 ? ` (+${citation.urls.length - 1})` : ''}`;
      button.onclick = (e) => handleCitationClick(citation, e);
      button.onmouseenter = (e) => handleCitationHover(citation, e);
      button.onmouseleave = handleCitationLeave;

      anchor.appendChild(button);
    });
  }, [citations, contentWithAnchors]);


  // Render markdown with citations removed, then inject buttons via DOM manipulation
  const rawHtml = marked(contentWithAnchors);
  const sanitizedHtml = DOMPurify.sanitize(rawHtml);

  return (
    <div className="message-content-with-citations">
      {/* Render content - citations will be injected as buttons */}
      <div
        ref={contentRef}
        className="message-content"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />

      {/* Hover preview card - positioned above button */}
      {hoveredCitation && hoverPosition && (
        <div
          className="citation-hover-preview"
          style={{
            left: `${hoverPosition.x}px`,
            top: `${hoverPosition.y}px`,
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={handleCitationLeave}
        >
          <a
            href={hoveredCitation.urls[currentSourceIndex]}
            target="_blank"
            rel="noopener noreferrer"
            className="citation-preview-card"
          >
            <div className="citation-preview-header">
              <div className="citation-preview-icon">
                {(() => {
                  try {
                    const hostname = new URL(hoveredCitation.urls[currentSourceIndex]).hostname;
                    const domainName = extractDomainName(hostname);
                    return domainName.charAt(0).toUpperCase();
                  } catch {
                    return hoveredCitation.index;
                  }
                })()}
              </div>
              <div className="citation-preview-title">
                <p className="citation-preview-domain">
                  {(() => {
                    try {
                      const hostname = new URL(hoveredCitation.urls[currentSourceIndex]).hostname;
                      return extractDomainName(hostname);
                    } catch {
                      return 'Source';
                    }
                  })()}
                </p>
                <p className="citation-preview-url">
                  {(() => {
                    try {
                      return new URL(hoveredCitation.urls[currentSourceIndex]).hostname;
                    } catch {
                      return hoveredCitation.urls[currentSourceIndex];
                    }
                  })()}
                </p>
              </div>
            </div>

            {hoveredCitation.text && (
              <p className="citation-preview-text">
                {hoveredCitation.text}
              </p>
            )}

            {hoveredCitation.urls.length > 1 && (
              <div className="citation-navigation">
                <button
                  className="citation-nav-button"
                  onClick={handlePrevSource}
                  disabled={currentSourceIndex === 0}
                  aria-label="Previous source"
                >
                  ←
                </button>
                <span className="citation-nav-counter">
                  {currentSourceIndex + 1} / {hoveredCitation.urls.length}
                </span>
                <button
                  className="citation-nav-button"
                  onClick={handleNextSource}
                  disabled={currentSourceIndex === hoveredCitation.urls.length - 1}
                  aria-label="Next source"
                >
                  →
                </button>
              </div>
            )}
          </a>
        </div>
      )}
    </div>
  );
}
