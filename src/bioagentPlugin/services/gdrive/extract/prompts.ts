export const extractionPrompt = `## **System Prompt**

You are a specialized assistant that generates JSON-LD objects for scientific papers. The output must strictly validate against the **PaperSchema** described below.

1. **PaperSchema Requirements**  
   - **\`@context\`**: Must be the fixed prefixes object.  
   - **\`@id\`**: A string identifier (preferably a DOI) for the paper.  
   - **\`@type\`**: Usually \`"bibo:AcademicArticle"\` or \`"schema:ScholarlyArticle"\`.  
   - **\`dcterms:title\`**: Title of the paper.  
   - **\`dcterms:creator\`**: Array of creator objects (authors). Each must have an \`@id\`, \`@type\`, and \`"foaf:name"\`.  
   - **\`dcterms:abstract\`**: Abstract text.  
   - **\`schema:datePublished\`**: Publication date in ISO 8601 format.  
   - **\`schema:keywords\`**: Array of free-text keywords.  
   - **\`fabio:hasPublicationVenue\`**: Metadata about the publication venue (journal or conference).  
   - **\`fabio:hasPart\`**: Array of sections, each with an ID, type, title, and content.  
   - **\`cito:cites\`**: Array of citations (with an ID, type, title, and DOI).  

2. **No Made-Up Placeholders**  
   - Provide accurate information based on the paper content.
   - If you aren't sure of exact details, provide a concise approximation based on available information.  

3. **Output Format**  
   - Return exactly one JSON object.  
   - No additional commentary.  
   - No markdown fences.  
   - Must parse successfully under the PaperSchema (Zod validator).  

4. **Quality & Realism**  
   - Provide realistic but concise bibliographic fields (title, authors, abstract, etc.).  
   - Extract main sections and their content from the paper.
   - Include multiple \`cito:cites\` references with real or plausible DOIs.  

**Your Role**:  
- Generate a single valid JSON-LD object that captures the key information from the scientific paper.
- Structure the content according to the PaperSchema requirements.
- Ensure all extracted information accurately represents the paper's content.

That's it. Output only the JSON object, nothing more.`;

export const ontologiesExtractionPrompt = `# Comprehensive Ontology Term Generation Prompt

Generate a rich, diverse set of ontology terms for my scientific paper JSON-LD using the following structure:

\`\`\`json
{
  "@id": "[PREFIX]:[ID_NUMBER]",
  "dcterms:name": "[OFFICIAL_LABEL]",
  "dcterms:description": "[DESCRIPTION]"
}
\`\`\`

## Required Ontologies:

Include terms from these ontologies (3-5 terms from each where relevant):

### Biomedical Ontologies:
- **Gene Ontology (GO)**: Include biological processes, molecular functions, and cellular components
- **Human Disease Ontology (DOID)**: For disease classifications and relationships
- **Chemical Entities of Biological Interest (ChEBI)**: For relevant chemical compounds
- **Anatomical Therapeutic Chemical (ATC)**: For drug classifications
- **Monarch Disease Ontology (MONDO)**: For unified disease representation
- **Pathway Ontology (PW)**: For biological pathways and interactions
- **Evidence & Conclusion Ontology (ECO)**: For evidence types supporting scientific claims
- **MeSH**: For medical subject headings, especially chemical terms

### Bibliographic Ontologies:
- **BIBO**: For bibliographic resource modeling
- **SPAR Ontologies**:
  - CiTO: For citation typing and relationships
  - BiRO: For bibliographic references
  - FaBiO: For scholarly works

## Term Selection Requirements:

1. **ALL terms MUST be real and verifiable** with:
   - Correct prefix format (e.g., "GO:0008150", "DOID:14330")
   - Genuine numeric ID (never use placeholders like "xxxx") 
   - Accurate official label as "dcterms:name"
   - Description of what was found regarding to that term in the paper, in "dcterms:description" field

2. **Prioritize terms that are:**
   - Domain-specific rather than overly general
   - Current and not deprecated
   - Relevant to my research topic
   - Include a mix of granularity levels

3. **Coverage requirements:**
   - Represent biological entities, processes, and functions
   - Include relevant diseases and conditions
   - Cover chemical compounds and drugs where applicable
   - Include pathway and interaction terms
   - Provide evidence classification terms

4. **DO NOT use any of the example ontology terms listed below unless they are specifically relevant to my research paper topic.** Select terms that actually apply to my research:

\`\`\`json
"schema:about": [
  {
    "@id": "GO:0006915",
    "dcterms:name": "apoptotic process",
    "dcterms:description": "The paper discusses programmed cell death mechanisms in relation to cancer development"
  },
  {
    "@id": "GO:0007154", 
    "dcterms:name": "cell communication",
    "dcterms:description": "The research examines intercellular signaling pathways between cancer cells"
  },
  {
    "@id": "DOID:14330",
    "dcterms:name": "lung cancer", 
    "dcterms:description": "Study includes analysis of lung cancer progression and metastasis"
  },
  {
    "@id": "MONDO:0005148",
    "dcterms:name": "breast cancer",
    "dcterms:description": "Research compares molecular mechanisms between breast and lung cancer types"
  },
  {
    "@id": "CHEBI:15377",
    "dcterms:name": "water",
    "dcterms:description": "Used as control solvent in experimental procedures"
  },
  {
    "@id": "CHEBI:27732",
    "dcterms:name": "morphine",
    "dcterms:description": "Discussed as analgesic treatment in cancer pain management"
  },
  {
    "@id": "ATC:N02AA01",
    "dcterms:name": "morphine",
    "dcterms:description": "Referenced in context of pain management protocols"
  },
  {
    "@id": "PW:0000013",
    "dcterms:name": "citric acid cycle pathway",
    "dcterms:description": "Analysis of metabolic changes in cancer cell energy production"
  },
  {
    "@id": "ECO:0000006",
    "dcterms:name": "experimental evidence",
    "dcterms:description": "Type of evidence used to support key findings in the research"
  },
  {
    "@id": "MESH:D015179",
    "dcterms:name": "Pre-Eclampsia",
    "dcterms:description": "Discussed as a complication affecting treatment options"
  }
]
\`\`\`

Provide a minimum of 25-30 diverse, relevant ontology terms that would appear in the "cito:discusses" section of my scientific paper. Ensure ALL terms are genuine entries that exist in their respective ontologies and are directly related to my specific research topic.`;
// TODO: perhaps replace schema:about with cito:discusses
