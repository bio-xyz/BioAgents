import OpenAI from 'openai';

export const QUERY_LIMIT = 8;
export const QUERY_LIMIT_LIGHTER = 20;

export const GRAPH_SCHEMA = {
  '@context': {
    schema: 'https://schema.org/',
    fabio: 'http://purl.org/spar/fabio/',
    cito: 'http://purl.org/spar/cito/',
    dcterms: 'http://purl.org/dc/terms/',
    foaf: 'http://xmlns.com/foaf/0.1/',
    bibo: 'http://purl.org/ontology/bibo/',
    go: 'http://purl.obolibrary.org/obo/GO_',
    doid: 'http://purl.obolibrary.org/obo/DOID_',
    chebi: 'http://purl.obolibrary.org/obo/CHEBI_',
    atc: 'http://purl.obolibrary.org/obo/ATC_',
    pw: 'http://purl.obolibrary.org/obo/PW_',
    eco: 'http://purl.obolibrary.org/obo/ECO_',
    mondo: 'http://purl.obolibrary.org/obo/MONDO_',
    comptox: 'https://comptox.epa.gov/',
    mesh: 'http://id.nlm.nih.gov/mesh/',
  },

  // The unique identifier for the paper (usually a DOI URL)
  '@id': 'string (DOI URL)',

  // The type of the paper (e.g., schema:ScholarlyArticle)
  '@type': 'string',

  // The title of the paper
  'dcterms:title': 'string',

  // The authors of the paper, as an array of objects
  'dcterms:creator': [
    {
      '@id': 'string (ORCID or unique author URI)',
      '@type': "string (usually 'foaf:Person')",
      'foaf:name': "string (author's full name)",
    },
    // ... more authors
  ],

  // The abstract of the paper
  'dcterms:abstract': 'string',

  // The publication date (ISO format)
  'schema:datePublished': "string (e.g., '2023-01-19')",

  // Keywords as an array of strings
  'schema:keywords': [
    'string',
    // ... more keywords
  ],

  // The publication venue (journal), as an object
  'fabio:hasPublicationVenue': {
    '@id': 'string (journal DOI or URI)',
    '@type': "string (usually 'fabio:Journal')",
    'schema:name': 'string (journal name)',
  },

  // Sections of the paper, as an array of objects
  'fabio:hasPart': [
    {
      '@id': 'string (section id)',
      '@type': "string (e.g., 'fabio:Section')",
      'dcterms:title': 'string (section title)',
      'fabio:hasContent': 'string (section content)',
    },
    // ... more sections
  ],

  // Citated papers, as an array of objects
  'cito:cites': [
    {
      '@id': 'string (DOI URL of citated paper)',
      '@type': "string (e.g., 'bibo:AcademicArticle' or 'schema:ScholarlyArticle')",
      'dcterms:title': 'string (title of citated paper)',
      'bibo:doi': 'string (short DOI)',
    },
    // ... more citations
  ],

  // Ontology terms about the paper, as an array of objects
  'schema:about': [
    {
      '@id': 'string (ontology term URL)',
      'dcterms:name': 'string (ontology term label)',
      'dcterms:description': "string (description of the term's relevance to the paper)",
    },
    // ... more ontology terms
  ],

  // Related organizations, as an array of objects
  'schema:relatedTo': [
    {
      '@id': 'string (organization id or URI)',
      '@type': "string (e.g., 'schema:Organization')",
      'schema:name': 'string (organization name)',
    },
    // ... more organizations
  ],
};

export const KG_TRIPLE_STORE_URL = process.env.KG_TRIPLE_STORE_URL || 'http://localhost:7878/query';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
