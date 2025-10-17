/**
 * Shared utility functions for LLM adapters
 */

/**
 * Extracts all URLs from the last message only
 */
export function extractUrlsFromMessages(
  messages: Array<{ role: string; content: string }>
): Set<string> {
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = new Set<string>();

  // Only check the last message (which is the user's current question)
  if (messages.length === 0) {
    return urls;
  }

  const lastMessage = messages[messages.length - 1];
  
  if(!lastMessage) {
    return urls;
  }

  const matches = lastMessage.content.match(urlPattern);

  if (matches) {
    matches.forEach((url) => {
      // Clean up URL (remove trailing punctuation)
      const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
      urls.add(cleanUrl);
    });
  }

  return urls;
}

/**
 * Checks if the last message contains a URL
 */
export function hasUrlInMessages(messages: Array<{ role: string; content: string }>): boolean {
  const urlPattern = /https?:\/\/[^\s]+/;

  if (messages.length === 0) {
    return false;
  }

  const lastMessage = messages[messages.length - 1];
  if(!lastMessage) {
    return false;
  }
  return urlPattern.test(lastMessage.content);
}

/**
 * Fetches static content from a URL with timeout
 */
export async function fetchStaticContent(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LLMBot/1.0)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';

    // Only process HTML and text content
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await response.text();

    // Simple text extraction from HTML
    const textContent = extractTextFromHtml(html);

    // Limit content to 4000 characters to avoid overwhelming the context
    return textContent.slice(0, 4000);
  } catch (error) {
    // Return null for timeouts, network errors, or dynamic content
    return null;
  }
}

/**
 * Extracts text content from HTML
 */
export function extractTextFromHtml(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Enriches messages with content fetched from URLs
 * Returns a new messages array with URL content appended
 */
export async function enrichMessagesWithUrlContent(
  messages: Array<{ role: string; content: string }>
): Promise<Array<{ role: string; content: string }>> {
  const urls = extractUrlsFromMessages(messages);

  if (urls.size === 0) {
    return messages;
  }

  // Fetch content from each URL
  const urlResults: Array<{ url: string; content: string | null }> = [];

  for (const url of urls) {
    try {
      const content = await fetchStaticContent(url);
      if (content && content.trim().length > 0) {
        urlResults.push({ url, content });
      } else {
        urlResults.push({ url, content: null });
      }
    } catch (error) {
      // Mark as failed to fetch
      console.debug(`Failed to fetch content from ${url}:`, error);
      urlResults.push({ url, content: null });
    }
  }

  // Build enrichment message
  const enrichmentParts = urlResults.map(({ url, content }) => {
    if (content) {
      return `Here is the content of the page ${url} that the user referenced. If it is related to the question, feel free to integrate it in the answer:\n\n${content}`;
    } else {
      return `Content of the page ${url} wasn't able to be read, but I can search the internet for other results.`;
    }
  });

  const enrichmentMessage = enrichmentParts.join('\n\n---\n\n');

  // Insert enrichment before the last message (which is typically the user's question)
  if (messages.length === 0) {
    return [
      {
        role: 'user',
        content: enrichmentMessage,
      },
    ];
  }

  const allButLast = messages.slice(0, -1);
  const lastMessage = messages[messages.length - 1]!;

  return [
    ...allButLast,
    {
      role: 'user',
      content: enrichmentMessage,
    },
    lastMessage,
  ];
}
