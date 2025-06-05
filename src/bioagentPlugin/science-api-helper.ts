import axios from "axios";
import { z, ZodTypeAny } from "zod";
import { logger } from "@elizaos/core";

// Define the Zod schema for a single citation
export const CitationSchema = z.object({
  "@id": z
    .string()
    .url() // Ensure it's a URL
    .describe(
      "A unique identifier (often a DOI) for the cited work being referenced, e.g., https://doi.org/10.1016/j.cell.2005.05.012."
    ),
  "@type": z
    .literal("bibo:AcademicArticle") // Explicitly set to 'bibo:AcademicArticle'
    .optional()
    .describe("RDF type of the cited resource, always 'bibo:AcademicArticle'"),
  "dcterms:title": z
    .string()
    .describe("Title of the cited work or resource.")
    .nullable(), // Title might not always be available
  "bibo:doi": z
    .string()
    .optional()
    .describe(
      "Explicit DOI string of the cited work, e.g. '10.1038/s41586-020-XXXXX'."
    ),
});

// Zod schema for an array of citations
export const CitationsArraySchema = z.array(CitationSchema);

/**
 * Attempts to retrieve the DOI (as a full URL) for a given paper title.
 * It tries Crossref first, then Semantic Scholar.
 *
 * @param title The title of the paper.
 * @param email Your email address for API "polite pool" usage.
 * @returns A Promise that resolves with the full DOI URL (e.g., "https://doi.org/...") if found, or null otherwise.
 */
export async function getDoiFromTitle(
  title: string,
  email: string | null
): Promise<string | null> {
  // --- Try Crossref API first ---
  try {
    const crossrefUrl = "https://api.crossref.org/works";
    const crossrefParams = {
      "query.title": title,
      rows: 1,
      mailto: email,
    };

    const response = await axios.get(crossrefUrl, {
      params: crossrefParams,
    });

    if (
      response.data &&
      response.data.message &&
      response.data.message.items &&
      response.data.message.items.length > 0
    ) {
      const firstResult = response.data.message.items[0];
      if (firstResult.DOI) {
        return `https://doi.org/${firstResult.DOI}`; // Return full URL
      }
    }
  } catch (error) {
    logger.warn(
      `Crossref API (title search) failed for "${title}":`,
      axios.isAxiosError(error) ? error.message : error
    );
  }

  // --- If Crossref fails, try Semantic Scholar API ---
  logger.info("Crossref did not find DOI, trying Semantic Scholar...");
  try {
    const semanticScholarUrl =
      "https://api.semanticscholar.org/graph/v1/paper/search";
    const semanticScholarParams = {
      query: title,
      fields: "title,externalIds", // Request title and externalIds (where DOI is)
    };
    const headers = {
      "User-Agent": `YourAppName/1.0 (mailto:${email})`,
    };

    const response = await axios.get(semanticScholarUrl, {
      params: semanticScholarParams,
      headers: headers,
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      const firstResult = response.data.data[0];
      if (firstResult.externalIds && firstResult.externalIds.DOI) {
        return `https://doi.org/${firstResult.externalIds.DOI}`; // Return full URL
      }
    }
  } catch (error) {
    logger.warn(
      `Semantic Scholar API (title search) failed for "${title}":`,
      axios.isAxiosError(error) ? error.message : error
    );
  }

  return null; // DOI not found via any method
}

/**
 * Fetches all references (papers cited BY the given DOI) from multiple APIs
 * and combines them into a unique list conforming to CitationSchema.
 *
 * @param doi The DOI of the paper to get references from.
 * @param email Your email address for API "polite pool" usage.
 * @returns A Promise that resolves with an array of CitationSchema objects.
 */
export async function getReferencesFromDoi(
  doi: string,
  email: string | null
): Promise<z.infer<typeof CitationsArraySchema>> {
  const allReferences: { [key: string]: z.infer<typeof CitationSchema> } = {}; // Use a map to deduplicate by DOI

  // Helper to add a reference to the map if it has a DOI
  const addReference = (
    refDoi: string | null | undefined,
    title: string | null | undefined
  ) => {
    if (refDoi) {
      const fullDoiUrl = `https://doi.org/${refDoi}`;

      // Check if the URL is valid
      try {
        new URL(fullDoiUrl);

        // Only add if not already present or if the new one has a better title
        if (
          !allReferences[fullDoiUrl] ||
          (title && !allReferences[fullDoiUrl]["dcterms:title"])
        ) {
          allReferences[fullDoiUrl] = {
            "@id": fullDoiUrl,
            "@type": "bibo:AcademicArticle",
            "dcterms:title": title || null,
            "bibo:doi": refDoi,
          };
        }
      } catch (error) {
        logger.warn(`Invalid URL generated from DOI: ${fullDoiUrl}`);
      }
    }
  };

  // --- 1. Get references from Crossref API ---
  try {
    const crossrefUrl = `https://api.crossref.org/works/${doi}`;
    const crossrefParams = {
      mailto: email,
    };
    const response = await axios.get(crossrefUrl, {
      params: crossrefParams,
    });

    if (
      response.data &&
      response.data.message &&
      response.data.message.reference &&
      response.data.message.reference.length > 0
    ) {
      response.data.message.reference.forEach((ref: any) => {
        // Crossref references can be messy, prioritize DOI
        const refTitle = Array.isArray(ref.title)
          ? ref.title[0]
          : ref.unstructured;
        addReference(ref.DOI, refTitle);
      });
      logger.info(
        `Found ${response.data.message.reference.length} references from Crossref.`
      );
    } else {
      logger.info(`No references found for ${doi} from Crossref.`);
    }
  } catch (error) {
    logger.warn(
      `Crossref API (references) failed for "${doi}":`,
      axios.isAxiosError(error) ? error.message : error
    );
  }

  // --- 2. Get references from Semantic Scholar API ---
  try {
    const semanticScholarUrl = `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}`;
    const semanticScholarParams = {
      fields: "references.externalIds,references.title",
    };
    const headers = {
      "User-Agent": `YourAppName/1.0 (mailto:${email})`,
    };

    const response = await axios.get(semanticScholarUrl, {
      params: semanticScholarParams,
      headers: headers,
    });

    if (
      response.data &&
      response.data.references &&
      response.data.references.length > 0
    ) {
      response.data.references.forEach((ref: any) => {
        addReference(ref.externalIds?.DOI, ref.title);
      });
      logger.info(
        `Found ${response.data.references.length} references from Semantic Scholar.`
      );
    } else {
      logger.info(`No references found for ${doi} from Semantic Scholar.`);
    }
  } catch (error) {
    logger.warn(
      `Semantic Scholar API (references) failed for "${doi}":`,
      axios.isAxiosError(error) ? error.message : error
    );
  }

  // --- 3. Get references from OpenCitations API ---
  try {
    const opencitationsUrl = `https://opencitations.net/index/api/v1/references/${doi}`;
    const response = await axios.get(opencitationsUrl);

    if (response.data && response.data.length > 0) {
      // OpenCitations `references` endpoint returns items where `cited` is the DOI of the reference
      for (const item of response.data) {
        if (item.cited) {
          // OpenCitations provides *only* the DOI. We'd need another API call
          // to get the title if not already found. For now, add with null title.

          // TODO: get title from OpenCitations, but unsure about API limits
          addReference(item.cited, null);
        }
      }
      logger.info(
        `Found ${response.data.length} references from OpenCitations.`
      );
    } else {
      logger.info(`No references found for ${doi} from OpenCitations.`);
    }
  } catch (error) {
    logger.warn(
      `OpenCitations API (references) failed for "${doi}":`,
      axios.isAxiosError(error) ? error.message : error
    );
  }

  // Convert the map of unique references back to an array
  const uniqueReferences = Object.values(allReferences);

  // Validate and return
  try {
    return CitationsArraySchema.parse(uniqueReferences);
  } catch (validationError) {
    logger.error(
      "Zod validation failed for combined references:",
      validationError
    );
    return []; // Return empty array on validation failure
  }
}
