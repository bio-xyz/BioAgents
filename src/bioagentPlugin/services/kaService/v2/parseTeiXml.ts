import libxmljs from "libxmljs";

const ns = { tei: "http://www.tei-c.org/ns/1.0" };

// Section definitions with main name and synonyms
const SECTION_DEFINITIONS = {
  introduction: ["introduction", "intro", "background"],
  methods: ["methods", "method", "methodology", "materials and methods"],
  results: ["results", "result", "findings"],
  discussion: ["discussion", "analysis", "interpretation"],
  conclusion: ["conclusion", "remarks", "summary"],
  futureWork: ["future work", "future research", "next steps"],
  appendix: ["appendix", "material", "supplementary"],
};

/**
 * Enhanced function to find and extract section content with multiple synonyms
 */
function findAndExtractSectionContent(
  // @ts-ignore
  doc: libxmljs.Document,
  sectionSynonyms: string[],
  namespaces: object
) {
  let sectionDiv = null;

  // Try each synonym until we find a match
  for (const synonym of sectionSynonyms) {
    // XPath to find by type attribute - EXACT match (preferred if available)
    const xpathTypeExact = `//tei:body//tei:div[@type='${synonym}']`;
    sectionDiv = doc.get(xpathTypeExact, namespaces);

    if (sectionDiv) break;

    // XPath to find by type attribute - PARTIAL match (contains)
    const xpathTypeContains = `//tei:body//tei:div[contains(translate(@type, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${synonym}')]`;
    sectionDiv = doc.get(xpathTypeContains, namespaces);

    if (sectionDiv) break;

    // If not found by type, try finding by <head> content - EXACT match (case-insensitive)
    const xpathHeadExact = `//tei:body//tei:div[translate(tei:head, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') = '${synonym}']`;
    sectionDiv = doc.get(xpathHeadExact, namespaces);

    if (sectionDiv) break;

    // Also try partial matching for head content
    const xpathHeadContains = `//tei:body//tei:div[contains(translate(tei:head, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${synonym}')]`;
    sectionDiv = doc.get(xpathHeadContains, namespaces);

    if (sectionDiv) break;
  }

  // If a div was found by any method, extract its content excluding the head
  if (sectionDiv) {
    // Find all direct child elements (*) of the sectionDiv that are NOT the <head> element
    const contentNodes = sectionDiv.find(
      "./tei:*[not(self::tei:head)]",
      namespaces
    );

    if (contentNodes && contentNodes.length > 0) {
      // Map each content node (like <p>, <formula>) to its trimmed text content
      // Join the text content of these nodes, separating them for readability (e.g., paragraphs)
      return contentNodes.map((node) => node.text().trim()).join("\n\n");
    } else {
      // Div was found but contained only a head or was empty otherwise.
      return ""; // Return empty string rather than null if the section div exists but is empty.
    }
  }

  // If no div was found by any method
  return null;
}

/**
 * Helper function for simpler extractions (like DOI, Abstract in header, listBibl).
 * Extracts the text content of the first matching node.
 * @param {libxmljs.Document} doc - The parsed libxmljs document.
 * @param {string} xpath - The XPath query string.
 * @param {object} namespaces - The namespace object for the query.
 * @returns {string | null} The trimmed text content of the found node, or null if not found.
 */
function extractTextSimple(
  // @ts-ignore
  doc: libxmljs.Document,
  xpath: string,
  namespaces: object
) {
  const node = doc.get(xpath, namespaces);
  return node ? node.text().trim() : null;
}

export async function parseXml(teiXml: string) {
  try {
    const doc = libxmljs.parseXml(teiXml);

    // 0. Extract Title
    const title =
      extractTextSimple(
        doc,
        "/tei:TEI/tei:teiHeader/tei:fileDesc/tei:titleStmt/tei:title[@level='a'][@type='main']",
        ns
      ) ||
      extractTextSimple(
        doc,
        "/tei:TEI/tei:teiHeader/tei:fileDesc/tei:titleStmt/tei:title",
        ns
      );

    console.log(`[parseXml] Got title: ${title}`);

    // 1. Extract DOI (using simple helper)
    const doi =
      extractTextSimple(
        doc,
        '/tei:TEI/tei:teiHeader/tei:fileDesc/tei:sourceDesc/tei:biblStruct/tei:idno[@type="DOI"]',
        ns
      ) ||
      extractTextSimple(
        // Fallback if @type="DOI" is missing
        doc,
        "/tei:TEI/tei:teiHeader/tei:fileDesc/tei:sourceDesc/tei:biblStruct/tei:idno",
        ns
      );

    // 2. Extract Abstract (using simple helper - common location)
    const abstract = extractTextSimple(
      doc,
      "/tei:TEI/tei:teiHeader/tei:profileDesc/tei:abstract",
      ns
    );

    // 3. Extract Citations (using simple helper - common location)
    const citations = extractTextSimple(doc, "//tei:back//tei:listBibl", ns);

    console.log(`[parseXml] Got citations of length: ${citations?.length}`);

    // 4. Extract Body Sections with synonyms
    const introduction = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.introduction,
      ns
    );

    console.log(`[parseXml] Got introduction: ${introduction?.length || 0}`);

    const methods = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.methods,
      ns
    );

    console.log(`[parseXml] Got methods: ${methods?.length || 0}`);

    const results = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.results,
      ns
    );

    console.log(`[parseXml] Got results: ${results?.length || 0}`);

    const discussion = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.discussion,
      ns
    );

    console.log(`[parseXml] Got discussion: ${discussion?.length || 0}`);

    const conclusion = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.conclusion,
      ns
    );

    console.log(`[parseXml] Got conclusion: ${conclusion?.length || 0}`);

    const futureWork = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.futureWork,
      ns
    );

    console.log(`[parseXml] Got future work: ${futureWork?.length || 0}`);

    const appendix = findAndExtractSectionContent(
      doc,
      SECTION_DEFINITIONS.appendix,
      ns
    );

    console.log(`[parseXml] Got appendix: ${appendix?.length || 0}`);

    // 5. Extract Publication Date
    const datePublished = extractTextSimple(
      doc,
      "/tei:TEI/tei:teiHeader/tei:fileDesc/tei:publicationStmt/tei:date[@type='published']",
      ns
    );

    console.log(`[parseXml] Got publication date: ${datePublished}`);

    // 6. Extract Publisher
    const publisher = extractTextSimple(
      doc,
      "/tei:TEI/tei:teiHeader/tei:fileDesc/tei:publicationStmt/tei:publisher",
      ns
    );

    console.log(`[parseXml] Got publisher: ${publisher}`);

    // 7. Extract Authors
    const authors: string[] = [];
    const authorNodes = doc.find(
      "//tei:TEI/tei:teiHeader/tei:fileDesc/tei:sourceDesc/tei:biblStruct/tei:analytic/tei:author",
      ns
    );

    for (const authorNode of authorNodes) {
      const forenames: string[] = [];
      // Get all forename nodes (type="first", type="middle")
      const forenameNodes = authorNode.find("./tei:persName/tei:forename", ns);
      for (const fNode of forenameNodes) {
        // @ts-ignore
        forenames.push(fNode.text().trim());
      }
      const surnameNode = authorNode.get("./tei:persName/tei:surname", ns);

      if (forenames.length > 0 || surnameNode) {
        const fullName =
          // @ts-ignore
          `${forenames.join(" ")} ${surnameNode ? surnameNode.text().trim() : ""}`.trim();
        authors.push(fullName);
      }
    }

    console.log(`[parseXml] Got ${authors.length} authors`);

    // Return the structured object
    return {
      title,
      doi,
      abstract,
      introduction,
      methods,
      results,
      discussion,
      conclusion,
      futureWork,
      appendix,
      citations,
      authors,
      datePublished,
      publisher,
    };
  } catch (error) {
    console.error("Failed to parse XML or extract sections:", error);
    // Return an object indicating failure
    return {
      title: null,
      doi: null,
      abstract: null,
      introduction: null,
      methods: null,
      results: null,
      discussion: null,
      conclusion: null,
      futureWork: null,
      appendix: null,
      citations: null,
      authors: null,
      datePublished: null,
      publisher: null,
      error: `Parsing failed: ${error.message}`,
    };
  }
}
