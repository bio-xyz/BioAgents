import { QUERY_LIMIT, QUERY_LIMIT_LIGHTER } from './constants';
import { GRAPH_SCHEMA } from './constants';
import {
  PaperSummarySchema,
  SimilarTermsSchema,
  PaperDetailsSchema,
  HypothesesSchema,
} from './schemas';
import { HYPOTHESIS_TOOL_CONFIG } from '../hypothesis-tool';

// Define all available tools with their descriptions
export const TOOLS = {
  SPARQL: [
    {
      name: 'CONCEPT_SEARCH',
      description:
        'Find papers related to a SINGLE concept (includes mechanisms, pathways, processes). Use this ONLY to search for a single concept.',
      template: `You are a SPARQL query generator for a knowledge graph containing academic papers. Generate a SPARQL query to find papers related to the specified single concept.
  
  ## Original Research Question: {{ question }}
  
  ## Task: Find papers related to this concept: {{ concepts }}
  Note: This tool is for searching a single concept.
  
  ## Requirements:
  - Search subject terms (not keywords)
  - Use UNION clauses for concept variations and synonyms
  - Use FILTER with CONTAINS and LCASE for flexible text matching
  - Include paper URI, title, abstract, termName, termDescription
  - Each paper is stored in its own named graph (DOI URL)
  - Use broad matching to capture relevant papers
  - Limit results to ${QUERY_LIMIT} papers
  
  ## Graph Schema:
  ${JSON.stringify(GRAPH_SCHEMA, null, 2)}
  
  ## Example Query:
  \`\`\`sparql
  PREFIX dcterms: <http://purl.org/dc/terms/>
  PREFIX schema: <https://schema.org/>
  
  SELECT DISTINCT ?doi ?title ?abstract ?termName ?termDescription WHERE {
    GRAPH ?doi {
      ?doi dcterms:title ?title ;
             dcterms:abstract ?abstract .   
      {
        ?doi schema:about ?term .
        ?term dcterms:name ?termName .
        OPTIONAL { ?term dcterms:description ?termDescription . }
        FILTER(CONTAINS(LCASE(?termName), "alzheimer"))
      }
      BIND(STRUUID() AS ?rnd)
    }
  }
  ORDER BY ?rnd
  LIMIT ${QUERY_LIMIT}
  \`\`\`
  
  Generate a SPARQL query for the specified concept:`,
      response_model: { schema: PaperSummarySchema, name: 'PaperSummary' },
      summarize: false,
      max_retries: 3,
    },
    //   {
    //     name: "GET_RELATED_CONCEPTS",
    //     description:
    //       "Find concepts that are related to a SINGLE given concept by being mentioned in the same papers. Use this tool when the scientist wants to widen the research scope based on a concept (which should be the input for the tool), not when they already know exactly what they want to research.",
    //     template: `You are a SPARQL query generator. Generate a query to find concepts that appear in papers alongside the specified concept.

    // ## Original Research Question: {{ question }}

    // ## Previous Step Results (if any) (can conclude the concept from previous step results in case a concept wasn't mentioned):
    // {{ previous_results }}

    // ## Task: Find concepts related to this passed concept or the one concluded from previous step results: {{ concepts }}

    // ## Requirements:
    // - Find papers that mention the input concept
    // - Get other concepts mentioned in those same papers
    // - Include concept names and descriptions, also paper DOI
    // - Filter out the input concept itself
    // - Limit results to ${QUERY_LIMIT_LIGHTER} related concepts
    // - Group and count occurrences to find most common related concepts

    // ## Graph Schema:
    // ${JSON.stringify(GRAPH_SCHEMA, null, 2)}

    // ## Example Query:
    // \`\`\`sparql
    // PREFIX dcterms: <http://purl.org/dc/terms/>
    // PREFIX schema: <https://schema.org/>

    // SELECT DISTINCT ?relatedTermName ?relatedTermDescription ?doi (COUNT(DISTINCT ?doi) as ?frequency) WHERE {
    //   GRAPH ?doi {
    //     # Find papers mentioning the input concept
    //     ?doi schema:about ?inputTerm .
    //     ?inputTerm dcterms:name ?inputTermName .
    //     FILTER(CONTAINS(LCASE(?inputTermName), "alzheimer"))

    //     # Get other concepts from same papers
    //     ?doi schema:about ?relatedTerm .
    //     ?relatedTerm dcterms:name ?relatedTermName .
    //     OPTIONAL { ?relatedTerm dcterms:description ?relatedTermDescription }

    //     # Filter out the input concept
    //     FILTER(!CONTAINS(LCASE(?relatedTermName), "alzheimer"))
    //   }
    // }
    // GROUP BY ?relatedTermName ?relatedTermDescription ?doi
    // ORDER BY DESC(?frequency)
    // LIMIT ${QUERY_LIMIT_LIGHTER}
    // \`\`\`

    // Generate a SPARQL query to find related concepts:`,
    //     response_model: { schema: SimilarTermsSchema, name: "SimilarTerms" },
    //     summarize: false,
    //     max_retries: 3,
    //   },
    {
      name: 'GET_AUTHOR_PAPERS_ON_CONCEPT',
      description: 'Find papers by specific authors that mention concepts',
      template: `You are a SPARQL query generator. Generate a query to find papers by specific authors that mention the specified concepts.
  
  ## Original Research Question: {{ question }}
  
  ## Task: Find papers by these authors: {{ authors }} that mention these concepts: {{ concepts }}
  
  ## Previous Step Results (if any):
  {{ previous_results }}
  
  ## Requirements:
  - Match author names with the specified authors
  - Papers must also mention the specified concepts (if there's no concept mentioned, return all papers from author without filtering for concepts)
  - Search concept mentions in titles, abstracts, keywords (if there are any concepts mentioned)
  - Return paper doi, title and abstract
  - Use flexible text matching for both authors and concepts
  - Limit results to ${QUERY_LIMIT_LIGHTER} papers
  
  ## Graph Schema:
  ${JSON.stringify(GRAPH_SCHEMA, null, 2)}
  
  ## Example Query:
  \`\`\`sparql
  PREFIX dcterms: <http://purl.org/dc/terms/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX schema: <https://schema.org/>
  
  SELECT DISTINCT ?doi ?title ?abstract WHERE {
    GRAPH ?doi {
      ?doi dcterms:title ?title ;
             dcterms:abstract ?abstract ;
             dcterms:creator ?authorNode .
      ?authorNode foaf:name ?author .
      
      # Author filter
      FILTER(CONTAINS(LCASE(?author), "smith") || CONTAINS(LCASE(?author), "johnson"))
      
      # Concept filter
      {
        FILTER(CONTAINS(LCASE(?title), "alzheimer") || CONTAINS(LCASE(?abstract), "alzheimer"))
      } UNION {
        ?doi schema:keywords ?keyword .
        FILTER(CONTAINS(LCASE(?keyword), "alzheimer"))
      } UNION {
        ?doi schema:about ?term .
        ?term dcterms:name ?termName .
        FILTER(CONTAINS(LCASE(?termName), "alzheimer"))
      }
      BIND(STRUUID() AS ?rnd)
    }
  }
  ORDER BY ?rnd
  LIMIT ${QUERY_LIMIT_LIGHTER}
  \`\`\`
  
  Generate a SPARQL query for the specified authors and concepts:`,
      response_model: { schema: PaperSummarySchema, name: 'PaperSummary' },
      summarize: false,
      max_retries: 3,
    },
    {
      name: 'GET_ALL_DATA_FROM_PAPER',
      description: 'Get all triples related to a specific paper',
      template: `You are a SPARQL query generator. Generate a query to get all triples related to a specific paper.
  
  ## Original Research Question: {{ question }}
  
  ## Task: Get all data about this paper: {{ paper }}
  
  ## Previous Step Results (if any):
  {{ previous_results }}
  
  ## Requirements:
  - Get paper ID, title, abstract
  - Get all ontology terms (schema:about) and their descriptions
  - Get all keywords
  - Get all authors
  - Include data from the paper's named graph
  
  ## Graph Schema:
  ${JSON.stringify(GRAPH_SCHEMA, null, 2)}
  
  ## Example Query:
  \`\`\`sparql
  PREFIX dcterms: <http://purl.org/dc/terms/>
  PREFIX schema: <https://schema.org/>
  PREFIX foaf: <http://xmlns.com/foaf/0.1/>
  PREFIX fabio: <http://purl.org/spar/fabio/>
  
  SELECT ?doi ?title ?abstract
         (GROUP_CONCAT(DISTINCT ?termName; SEPARATOR=', ') AS ?allTermNames)
         (GROUP_CONCAT(DISTINCT ?termDescription; SEPARATOR=' | ') AS ?allTermDescriptions)
         (GROUP_CONCAT(DISTINCT ?keyword; SEPARATOR=', ') AS ?allKeywords)
         (GROUP_CONCAT(DISTINCT ?authorName; SEPARATOR=', ') AS ?allAuthorNames)
  WHERE {
    GRAPH <https://doi.org/10.1101/2024.09.13.612929> {
      ?doi dcterms:title ?title ;
             dcterms:abstract ?abstract .  
        ?doi schema:about ?term .
        ?term dcterms:name ?termName .
        OPTIONAL { ?term dcterms:description ?termDescription }
        ?doi schema:keywords ?keyword .
        ?doi dcterms:creator ?author .
        ?author foaf:name ?authorName .
        BIND(STRUUID() AS ?rnd)
    }
  }
  GROUP BY ?doi ?title ?abstract
  ORDER BY ?rnd
  \`\`\`
  
  Generate a SPARQL query to get all data about the specified paper:`,
      response_model: { schema: PaperDetailsSchema, name: 'PaperDetails' },
      summarize: false,
      max_retries: 3,
    },
  ],
  HYPOTHESIS: [HYPOTHESIS_TOOL_CONFIG],
};

// Generate planning prompt from tools
export const PLANNING_PROMPT = `You are a research query planner. Create a strategic execution plan using these available step types:

## SPARQL-Based Steps (Query the science knowledge graph):
${TOOLS.SPARQL.map((tool, i) => `${i + 1}. **${tool.name}** - ${tool.description}`).join('\n')}

## Hypothesis-Based Steps (Custom hypothesis generation with pre/post processing):
${TOOLS.HYPOTHESIS.map(
  (tool, i) => `${i + TOOLS.SPARQL.length + 1}. **${tool.name}** - ${tool.description}`
).join('\n')}

## Response Format: (output only the JSON object, no other text, no markdown, no comments, no explanation, no nothing)
{
  "plan": [
    {
      "step": 1,
      "type": "CONCEPT_SEARCH",
      "inputs": {
        "concepts": ["alzheimer"]
      },
      "depends_on": []
    },
    {
      "step": 2,
      "type": "GET_CITED_PAPERS",
      "inputs": {},
      "depends_on": [1]
    }
  ]
}

Always use the minimum amount of steps possible. Your goal is to create the most efficient plan which will yield the most relevant results, while still following the rules described by all the tools. For example, if the scientist already knows what they want to research, you should not use the GET_RELATED_CONCEPTS tool, unless they stated that they want to widen the research scope. Create a plan for: `;

// Convert tools arrays into lookup objects for easier access
export const SPARQL_TOOLS = Object.fromEntries(TOOLS.SPARQL.map((tool) => [tool.name, tool]));

export const HYPOTHESIS_TOOLS = Object.fromEntries(
  TOOLS.HYPOTHESIS.map((tool) => [tool.name, tool])
);
