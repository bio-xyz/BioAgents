import React from 'react';
import TOCItems from '@theme-original/TOCItems';
import styles from './styles.module.css';

function CopyPageButton(): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);

  const copyMarkdownContent = async () => {
    try {
      const articleElement = document.querySelector('article');
      if (!articleElement) {
        throw new Error('Article element not found');
      }

      const titleElement = articleElement.querySelector('h1');
      const title = titleElement ? titleElement.textContent : '';

      let markdownContent = `# ${title}\n\n`;

      const contentElements = articleElement.querySelectorAll('h2, h3, h4, p, pre, ul, ol, blockquote');
      
      contentElements.forEach((element) => {
        const tagName = element.tagName.toLowerCase();
        
        if (tagName === 'h2') {
          markdownContent += `\n## ${element.textContent}\n\n`;
        } else if (tagName === 'h3') {
          markdownContent += `\n### ${element.textContent}\n\n`;
        } else if (tagName === 'h4') {
          markdownContent += `\n#### ${element.textContent}\n\n`;
        } else if (tagName === 'p') {
          markdownContent += `${element.textContent}\n\n`;
        } else if (tagName === 'pre') {
          const codeElement = element.querySelector('code');
          if (codeElement) {
            const language = codeElement.className.match(/language-(\w+)/)?.[1] || '';
            markdownContent += `\`\`\`${language}\n${codeElement.textContent}\n\`\`\`\n\n`;
          }
        } else if (tagName === 'ul' || tagName === 'ol') {
          const items = element.querySelectorAll('li');
          items.forEach((item) => {
            markdownContent += `- ${item.textContent}\n`;
          });
          markdownContent += '\n';
        } else if (tagName === 'blockquote') {
          markdownContent += `> ${element.textContent}\n\n`;
        }
      });

      await navigator.clipboard.writeText(markdownContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy markdown:', error);
      alert('Failed to copy content. Please try again.');
    }
  };

  return (
    <button
      onClick={copyMarkdownContent}
      className={styles.copyButton}
      title="Copy page as Markdown for AI agents"
    >
      {copied ? (
        <>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.5 5.5H7.5C6.94772 5.5 6.5 5.94772 6.5 6.5V12.5C6.5 13.0523 6.94772 13.5 7.5 13.5H13.5C14.0523 13.5 14.5 13.0523 14.5 12.5V6.5C14.5 5.94772 14.0523 5.5 13.5 5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3.5 10.5H2.5C2.23478 10.5 1.98043 10.3946 1.79289 10.2071C1.60536 10.0196 1.5 9.76522 1.5 9.5V2.5C1.5 2.23478 1.60536 1.98043 1.79289 1.79289C1.98043 1.60536 2.23478 1.5 2.5 1.5H9.5C9.76522 1.5 10.0196 1.60536 10.2071 1.79289C10.3946 1.98043 10.5 2.23478 10.5 2.5V3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Copy page</span>
        </>
      )}
    </button>
  );
}

export default function TOCItemsWrapper(props) {
  return (
    <>
      <div className={styles.copyButtonContainer}>
        <CopyPageButton />
      </div>
      <TOCItems {...props} />
    </>
  );
}

