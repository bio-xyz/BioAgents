/**
 * Citation parsing utilities for inline citations
 * Supports format: [cited text]{url1,url2,...}
 */

export interface Citation {
  text: string;
  urls: string[];
  index: number;
  originalMatch: string;
}

/**
 * Parse citations from text in format [text]{url1,url2}
 */
export function parseCitationsFromText(text: string): {
  citations: Citation[];
  textWithoutCitations: string;
} {
  const citations: Citation[] = [];
  // Updated regex to allow empty brackets and empty braces: [^\]]* and [^\}]*
  const citationRegex = /\[([^\]]*)\]\{([^\}]*)\}/g;

  let match;
  let index = 1;

  while ((match = citationRegex.exec(text)) !== null) {
    const citedText = match[1];
    const urlsString = match[2];
    const urls = urlsString ? urlsString.split(',').map(url => url.trim()).filter(url => url) : [];

    // Only add citations that have URLs
    if (urls.length > 0) {
      citations.push({
        text: citedText,
        urls,
        index,
        originalMatch: match[0]
      });
      index++;
    }
  }

  // Remove citation markers from text
  // Replace [text]{urls} with just 'text' (keeping the cited text)
  // Replace [text]{} or []{} with just 'text' or nothing (removing empty citations)
  const textWithoutCitations = text.replace(citationRegex, (match, citedText) => {
    return citedText || ''; // Return the cited text, or empty string if no text
  });

  return {
    citations,
    textWithoutCitations
  };
}

/**
 * Extract unique citations by URL
 */
export function extractUniqueCitations(citations: Citation[]): Array<{
  url: string;
  indices: number[];
}> {
  const urlMap = new Map<string, number[]>();

  citations.forEach(citation => {
    citation.urls.forEach(url => {
      if (!urlMap.has(url)) {
        urlMap.set(url, []);
      }
      urlMap.get(url)!.push(citation.index);
    });
  });

  return Array.from(urlMap.entries()).map(([url, indices]) => ({
    url,
    indices
  }));
}

/**
 * Extract domain name from URL
 */
export function extractDomainName(hostname: string): string {
  // Remove 'www.' prefix if present
  const withoutWww = hostname.replace(/^www\./, '');

  // Split by dots and get the main domain name
  const parts = withoutWww.split('.');

  // Handle common cases
  if (parts.length >= 2) {
    const twoPartTlds = ['co', 'com', 'gov', 'edu', 'ac', 'org', 'net'];
    const secondLastPart = parts[parts.length - 2];

    if (parts.length >= 3 && twoPartTlds.includes(secondLastPart)) {
      return parts[parts.length - 3];
    }

    return parts[parts.length - 2];
  }

  return withoutWww;
}
