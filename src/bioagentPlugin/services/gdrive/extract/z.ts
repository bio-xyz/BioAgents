import { z } from "zod";
import crypto from "crypto";

/*
 * Standardized schema for scientific paper Knowledge Asset
 * with comprehensive descriptions for semantic interoperability
 */

// TODO: add IPFS

// fixed default context with additional biomedical ontologies
const defaultContext = {
  schema: "https://schema.org/",
  fabio: "http://purl.org/spar/fabio/",
  cito: "http://purl.org/spar/cito/",
  dcterms: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  bibo: "http://purl.org/ontology/bibo/",
  go: "http://purl.obolibrary.org/obo/GO_",
  doid: "http://purl.org/obo/DOID_",
  chebi: "http://purl.org/obo/CHEBI_",
  atc: "http://purl.org/obo/ATC_",
  pw: "http://purl.org/obo/PW_",
  eco: "http://purl.org/obo/ECO_",
  mondo: "http://purl.org/obo/MONDO_",
  comptox: "https://comptox.epa.gov/",
  mesh: "http://id.nlm.nih.gov/mesh/",
  doco: "http://purl.org/spar/doco/",
  pro: "http://purl.org/spar/pro/",
  obi: "http://purl.obolibrary.org/obo/",
} as const;

const ContextSchema = z
  .object({
    schema: z.literal("https://schema.org/"),
    fabio: z.literal("http://purl.org/spar/fabio/"),
    cito: z.literal("http://purl.org/spar/cito/"),
    dcterms: z.literal("http://purl.org/dc/terms/"),
    foaf: z.literal("http://xmlns.com/foaf/0.1/"),
    bibo: z.literal("http://purl.org/ontology/bibo/"),
    go: z.literal("http://purl.obolibrary.org/obo/GO_"),
    doid: z.literal("http://purl.org/obo/DOID_"),
    chebi: z.literal("http://purl.org/obo/CHEBI_"),
    atc: z.literal("http://purl.org/obo/ATC_"),
    pw: z.literal("http://purl.org/obo/PW_"),
    eco: z.literal("http://purl.org/obo/ECO_"),
    mondo: z.literal("http://purl.org/obo/MONDO_"),
    comptox: z.literal("https://comptox.epa.gov/"),
    mesh: z.literal("http://id.nlm.nih.gov/mesh/"),
    doco: z.literal("http://purl.org/spar/doco/").optional(),
    pro: z.literal("http://purl.org/spar/pro/").optional(),
    obi: z.literal("http://purl.obolibrary.org/obo/").optional(),
  })
  .default(defaultContext)
  .describe(
    "Context prefixes for JSON-LD, mapping short prefixes (e.g. go:) to full IRIs to enable semantic interoperability."
  );

// creator (author) schema
const CreatorSchema = z.object({
  "@id": z
    .string()
    .describe(
      "Unique identifier for the creator, typically an ORCID URI (e.g., https://orcid.org/0000-0003-8245-1234)."
    )
    .default(`https://orcid.org/${crypto.randomUUID()}`),
  "@type": z
    .string()
    .describe(
      "RDF type of the creator (e.g. foaf:Person). Identifies the class of this entity in Linked Data."
    ),
  "foaf:name": z
    .string()
    .describe(
      "Full display name of the creator, e.g. 'Alice Smith' or 'Alice B. Smith'."
    ),
});

// publication venue schema
const PublicationVenueSchema = z.object({
  "@id": z
    .string()
    .describe(
      "Primary identifier (e.g. DOI) of the publication venue (journal, conference, repository)."
    ),
  "@type": z
    .string()
    .describe(
      "RDF type of the publication venue (e.g. fabio:Journal, schema:Periodical)."
    ),
  "schema:name": z
    .string()
    .describe(
      "Human-readable name of the publication venue, e.g. 'Nature' or 'Proceedings of XYZ Conference'."
    ),
});

// section schema
const SectionSchema = z.object({
  "@id": z
    .string()
    .describe(
      "Short ID or local identifier for this section, often used as a fragment or anchor."
    ),
  "@type": z
    .string()
    .describe(
      "RDF type for the section, e.g. 'fabio:Section' or similar to define its role in the paper."
    ),
  "dcterms:title": z
    .string()
    .describe(
      "Heading or title of this section, e.g. 'Methods', 'Results', 'Discussion'."
    ),
  "fabio:hasContent": z
    .string()
    .describe(
      "Full textual content of the section (may include paragraphs of text, tables, etc.)."
    ),
});

// citation schema
const CitationSchema = z.object({
  "@id": z
    .string()
    .describe(
      "A unique identifier (often a DOI) for the cited work being referenced, e.g., https://doi.org/10.1016/j.cell.2005.05.012."
    ),
  "@type": z
    .string()
    .optional()
    .describe(
      "RDF type of the cited resource, e.g. 'bibo:AcademicArticle' or 'schema:ScholarlyArticle'."
    ),
  "dcterms:title": z.string().describe("Title of the cited work or resource."),
  "bibo:doi": z
    .string()
    .optional()
    .describe(
      "Explicit DOI string of the cited work, e.g. '10.1038/s41586-020-XXXXX'."
    ),
});

// Enhanced ontology term schema with additional relationships
export const OntologyTermSchema = z.object({
  "@id": z
    .string()
    .describe(
      "IRI of the ontology term (e.g., http://purl.obolibrary.org/obo/GO_0070765 for 'gamma secretase activity')."
    ),
  "dcterms:name": z
    .string()
    .describe(
      "Human-readable label of the ontology term (e.g., 'gamma secretase activity')."
    ),
  "dcterms:title": z
    .string()
    .optional()
    .describe(
      "Title of the ontology term, typically used for disease or chemical entities."
    ),
  "dcterms:description": z
    .string()
    .describe(
      "Detailed description of the ontology term and its relevance to the paper."
    ),
  "obi:RO_0002304": z
    .lazy((): z.ZodType => OntologyTermSchema)
    .optional()
    .describe(
      "Represents a 'regulates' relationship to another ontology term."
    ),
  "obi:BFO_0000050": z
    .lazy((): z.ZodType => OntologyTermSchema)
    .optional()
    .describe("Represents a 'part of' relationship to another ontology term."),
  "obi:RO_0002233": z
    .lazy((): z.ZodType => OntologyTermSchema)
    .optional()
    .describe(
      "Represents a 'has input' relationship to another ontology term."
    ),
});

// Cell schema for experimental materials
const CellLineSchema = z.object({
  "@id": z
    .string()
    .describe(
      "IRI of the cell line or biological material (e.g., http://purl.obolibrary.org/obo/CLO_0009443)."
    ),
  "dcterms:description": z
    .string()
    .describe(
      "Description of the cell lines or biological materials used in the research."
    ),
});

// Experimental method schema
const ExperimentalMethodSchema = z.object({
  "@id": z
    .string()
    .describe(
      "IRI of the experimental method (e.g., http://purl.obolibrary.org/obo/OBI_0000070)."
    ),
  "dcterms:description": z
    .string()
    .describe("Description of the experimental method used in the research."),
});

// Competing interests schema
const CompetingInterestSchema = z.object({
  "@id": z.string().describe("IRI related to competing interests declaration."),
  "dcterms:description": z
    .string()
    .describe(
      "Statement regarding competing interests or conflicts of interest."
    ),
});

// Related organization schema
const RelatedOrganizationSchema = z.object({
  "@id": z
    .string()
    .describe(
      "Identifier for the related organization, typically a DID (e.g., did:dkg:base:84532/...)."
    ),
  "@type": z
    .string()
    .describe("Type of the related entity, typically 'schema:Organization'."),
  "schema:name": z
    .string()
    .describe(
      "Name of the related organization (e.g., 'VitaDAO', 'Cerebrum DAO')."
    ),
});

export const OntologiesSchema = z.object({
  "schema:about": z.array(OntologyTermSchema),
});

// research paper schema
export const PaperSchema = z
  .object({
    "@context": ContextSchema,
    "@id": z
      .string()
      .describe(
        "Top-level identifier for the paper, typically a DOI (e.g., https://doi.org/10.1371/journal.pone.0173240)."
      )
      // TODO: look into whether the default is screwing stuff up
      .default(`https://doi.org/10.1234/${crypto.randomInt(10000, 99999)}`),
    "@type": z.string().describe(
      // TODO: perhaps should just use one of these
      "Type of the paper (e.g., 'fabio:ResearchPaper', 'bibo:AcademicArticle', 'schema:ScholarlyArticle')."
    ),
    "dcterms:title": z
      .string()
      .describe("Full title of the paper as it appears in the publication."),
    "dcterms:creator": z
      .array(CreatorSchema)
      .describe(
        "List of authors/creators of the paper, with their identifiers and names."
      ),
    "dcterms:abstract": z
      .string()
      .describe(
        "Complete abstract text summarizing the paper's content, methods, and findings."
      ),
    "dcterms:date": z
      .string()
      .optional()
      .describe("Publication date in YYYY-MM-DD format."),
    "schema:datePublished": z
      .string()
      .optional()
      .describe(
        "Alternative property for publication date, usually in ISO 8601 format (YYYY-MM-DD)."
      ),
    "dcterms:publisher": z
      .string()
      .optional()
      .describe(
        "Name of the publisher of the paper (e.g., 'PLOS ONE', 'Nature Publishing Group')."
      ),
    "fabio:hasJournalVolume": z
      .string()
      .optional()
      .describe(
        "Volume number of the journal in which the paper was published."
      ),
    "fabio:hasJournalIssue": z
      .string()
      .optional()
      .describe(
        "Issue number of the journal in which the paper was published."
      ),
    "fabio:hasPageNumbers": z
      .string()
      .optional()
      .describe(
        "Page range of the paper in the publication (e.g., '1-18', '234-245')."
      ),
    "dcterms:identifier": z
      .string()
      .optional()
      .describe("Alternative identifier for the paper, typically a DOI URL."),
    "schema:keywords": z
      .array(z.string())
      .optional()
      .describe(
        "List of keywords or key phrases describing the paper's topics."
      ),
    "fabio:hasPublicationVenue": PublicationVenueSchema.optional().describe(
      "Metadata about where this paper was published (journal, conference, etc.)."
    ),
    "fabio:hasPart": z
      .array(SectionSchema)
      .optional()
      .describe(
        "Structured sections that compose the paper (with @id, @type, title, and content)."
      ),
    "dcterms:hasPart": z
      .string()
      .optional()
      .describe(
        "Plain text representation of the paper's content, useful for full-text search and analysis."
      ),
    // TODO: this is not performing well
    "cito:cites": z
      .array(CitationSchema)
      .describe(
        "References/citations the paper includes, with identifiers and titles."
      ),
    // TODO: these are never extracted it seems, but the OntologySchema is followed (ontologies:)
    "obi:OBI_0000299": z
      .array(OntologyTermSchema)
      .optional()
      .describe(
        "Ontology terms and concepts discussed in the paper, with rich relationships and descriptions."
      ),
    "obi:OBI_0000293": z
      .array(CellLineSchema)
      .optional()
      .describe("Cell lines or biological materials used in the research."),
    "obi:OBI_0000070": z
      .array(ExperimentalMethodSchema)
      .optional()
      .describe("Experimental methods used in the research."),
    "obi:IAO_0000616": z
      .array(CompetingInterestSchema)
      .optional()
      .describe(
        "Declarations regarding competing interests or conflicts of interest."
      ),
    "schema:relatedTo": z
      .array(RelatedOrganizationSchema)
      .optional()
      .describe(
        "Organizations or entities related to the paper, such as funders or stakeholders."
      ),
  })
  .describe(
    "Comprehensive JSON-LD schema for a scientific paper, capturing bibliographic metadata, content, ontology terms, and semantic relationships."
  );

export type Paper = z.infer<typeof PaperSchema>;
