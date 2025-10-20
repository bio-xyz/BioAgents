import type { WebSearchResult } from "../llm/types";
import type { Paper, State } from "../types/core";

export function addVariablesToState(
  state: State,
  variables: Record<string, any>,
) {
  state.values = {
    ...state.values,
    ...variables,
  };
}

export function composePromptFromState(state: State, prompt: string): string {
  // for each key in state.values, replace the {{key}} with the value of the key
  for (const key in state.values) {
    prompt = prompt.replace(`{{${key}}}`, state.values[key]);
  }
  return prompt;
}

export function getUniquePapers(state: State): Paper[] {
  // Merge papers from both KG and OpenScholar without duplicates
  const kgPapers = state.values.kgPapers || [];

  // Transform OpenScholar raw data to include chunk text as abstract
  const openScholarPapers = (state.values.openScholarRaw || []).map(
    (paper: any) => ({
      doi: paper.doi,
      title: paper.title,
      abstract: paper.chunkText, // Use chunk text as abstract
    }),
  );

  const allPapers = [...kgPapers, ...openScholarPapers];
  // Deduplicate by DOI (keep first occurrence)
  const seenDois = new Set<string>();
  const uniquePapers = allPapers.filter((paper) => {
    const doi = paper.doi;
    if (!doi || seenDois.has(doi)) return false;
    seenDois.add(doi);
    return true;
  });

  return uniquePapers;
}

export function cleanWebSearchResults(
  webSearchResults: WebSearchResult[],
): WebSearchResult[] {
  return webSearchResults.map((result) => {
    let cleanedTitle = result.title;

    // Check if title looks like a URL
    if (
      cleanedTitle.startsWith("http://") ||
      cleanedTitle.startsWith("https://") ||
      cleanedTitle.startsWith("www.")
    ) {
      try {
        // Parse the URL to extract just the domain
        const urlToParse = cleanedTitle.startsWith("www.")
          ? `https://${cleanedTitle}`
          : cleanedTitle;
        const parsedUrl = new URL(urlToParse);
        cleanedTitle = parsedUrl.hostname.replace(/^www\./, "www.");

        // Ensure it starts with www.
        if (!cleanedTitle.startsWith("www.")) {
          cleanedTitle = "www." + cleanedTitle;
        }
      } catch {
        // If parsing fails, keep the original title
      }
    }

    return {
      ...result,
      title: cleanedTitle,
    };
  });
}
