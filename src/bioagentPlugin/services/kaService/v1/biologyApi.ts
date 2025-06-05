// searchOntology.ts

import { logger } from "@elizaos/core";
import axios, { AxiosResponse } from "axios";
import "dotenv/config";
import { generateResponse } from "./anthropicClient";
import {
  get_go_api_prompt,
  get_doid_api_prompt,
  get_chebi_api_prompt,
  get_atc_api_prompt,
  get_mondo_api_prompt,
  get_eco_api_prompt,
  get_pw_api_prompt,
  get_mesh_api_prompt,
} from "./llmPrompt";
import Anthropic from "@anthropic-ai/sdk";

const bioontologyApiKey: string | undefined = process.env.BIONTOLOGY_KEY;

/**
 * Extract the last part of a URL's path.
 * E.g., if the URL ends with "/A12BC51", returns "A12BC51".
 * E.g., if URL is "http://purl.obolibrary.org/obo/PW_0000001", returns "PW_0000001".
 */
export function extractLastUriSegment(url: string): string | null {
  const match = url.match(/\/([^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Search for a term in the Gene Ontology via QuickGO API.
 */
export async function searchGo(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://www.ebi.ac.uk/QuickGO/services/ontology/go/search";
  const params = { query: term, limit: 5, page: 1 };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });
    if (apiResponse.status === 200) {
      // QuickGO results are in apiResponse.data.results
      // Each result has 'id', 'name', 'definition.text'
      const goCandidates =
        apiResponse.data.results?.slice(0, 4).map((candidate) => ({
          short_form: candidate.id,
          label: candidate.name,
          description: candidate.definition?.text || "",
        })) || [];
      const promptGoApi = get_go_api_prompt(term, goCandidates);

      newTerm = await generateResponse(client, promptGoApi, modelIdentifier);

      if (newTerm.includes("GO:")) {
        newTerm = newTerm.replace("GO:", "GO_");
      }
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.info(`QuickGO API (GO) gave response code ${apiResponse.status}`);
    }
  } catch (error) {
    logger.error(`Error searching GO: ${error}`);
  }

  return newTerm;
}

/**
 * Search for a term in the DOID Ontology via EBI OLS4 API.
 */
export async function searchDoid(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://www.ebi.ac.uk/ols4/api/search"; // Updated to OLS4
  const params = {
    q: term,
    ontology: "doid",
    rows: 5, // OLS uses 'rows' for limit
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      const found = data.response?.numFound || 0;
      // OLS4 results are in data.response.docs
      // Each doc has 'short_form', 'label', 'description' (array)
      const doidCandidates =
        found > 0
          ? data.response.docs.slice(0, 4).map((candidate) => ({
              short_form: candidate.short_form,
              description: candidate.description?.[0] || "",
              label: candidate.label,
            }))
          : [];

      const promptDoidApi = get_doid_api_prompt(term, doidCandidates);
      newTerm = await generateResponse(client, promptDoidApi, modelIdentifier);

      if (newTerm.includes("DOID:")) {
        newTerm = newTerm.replace("DOID:", "DOID_");
      }
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `EBI OLS4 API (DOID) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching DOID: ${error}`);
  }

  return newTerm;
}

/**
 * Search for a term in the ChEBI Ontology via EBI OLS4 API.
 */
export async function searchChebi(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://www.ebi.ac.uk/ols4/api/search"; // Updated to OLS4
  const params = {
    q: term,
    ontology: "chebi",
    rows: 5, // OLS uses 'rows' for limit
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      const found = data.response?.numFound || 0;
      // OLS4 results are in data.response.docs
      // Each doc has 'short_form', 'label', 'description' (array)
      const chebiCandidates =
        found > 0
          ? data.response.docs.slice(0, 4).map((candidate) => ({
              short_form: candidate.short_form,
              description: candidate.description?.[0] || "",
              label: candidate.label,
            }))
          : [];

      const promptChebiApi = get_chebi_api_prompt(term, chebiCandidates);
      newTerm = await generateResponse(client, promptChebiApi, modelIdentifier);

      if (newTerm.includes("CHEBI:")) {
        newTerm = newTerm.replace("CHEBI:", "CHEBI_");
      }
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `EBI OLS4 API (ChEBI) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching ChEBI: ${error}`);
  }

  return newTerm;
}

/**
 * Search for a term in the ATC Ontology via BioOntology API.
 */
export async function searchAtc(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://data.bioontology.org/search";
  const params = {
    q: term,
    ontologies: "ATC",
    apikey: bioontologyApiKey,
    pagesize: 5, // BioOntology uses 'pagesize'
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      // BioOntology results are in data.collection
      // Each result has '@id', 'prefLabel', 'definition' (array)
      let atcCandidates = [];
      if (data.collection && data.collection.length > 0) {
        atcCandidates = data.collection.slice(0, 4).map((candidate) => ({
          short_form: extractLastUriSegment(candidate["@id"]),
          description: candidate["definition"]?.[0] || "",
          label: candidate["prefLabel"],
        }));
      }
      const promptAtcApi = get_atc_api_prompt(term, atcCandidates);
      newTerm = await generateResponse(client, promptAtcApi, modelIdentifier);

      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `BioOntology API (ATC) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching ATC: ${error}`);
  }

  return newTerm;
}

/**
 * Search for a term in the Mondo Ontology via EBI OLS4 API.
 */
export async function searchMondo(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://www.ebi.ac.uk/ols4/api/search";
  const params = {
    q: term,
    ontology: "mondo",
    rows: 5,
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      const found = data.response?.numFound || 0;
      const mondoCandidates =
        found > 0
          ? data.response.docs.slice(0, 4).map((candidate) => ({
              short_form: candidate.short_form,
              description: candidate.description?.[0] || "",
              label: candidate.label,
            }))
          : [];

      const promptMondoApi = get_mondo_api_prompt(term, mondoCandidates);
      newTerm = await generateResponse(client, promptMondoApi, modelIdentifier);

      if (newTerm.includes("MONDO:")) {
        newTerm = newTerm.replace("MONDO:", "MONDO_");
      }
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `EBI OLS4 API (Mondo) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching Mondo: ${error}`);
  }
  return newTerm;
}

/**
 * Search for a term in the ECO Ontology via QuickGO API.
 */
export async function searchEco(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://www.ebi.ac.uk/QuickGO/services/ontology/eco/search";
  const params = { query: term, limit: 5, page: 1 };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });
    if (apiResponse.status === 200) {
      const ecoCandidates =
        apiResponse.data.results?.slice(0, 4).map((candidate) => ({
          short_form: candidate.id, // QuickGO uses 'id'
          label: candidate.name, // QuickGO uses 'name'
          description: candidate.definition?.text || "",
        })) || [];
      const promptEcoApi = get_eco_api_prompt(term, ecoCandidates);

      newTerm = await generateResponse(client, promptEcoApi, modelIdentifier);

      if (newTerm.includes("ECO:")) {
        newTerm = newTerm.replace("ECO:", "ECO_");
      }
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.info(`QuickGO API (ECO) gave response code ${apiResponse.status}`);
    }
  } catch (error) {
    logger.error(`Error searching ECO: ${error}`);
  }

  return newTerm;
}

/**
 * Search for a term in the Pathway Ontology (PW) via BioOntology API.
 */
export async function searchPw(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://data.bioontology.org/search";
  const params = {
    q: term,
    ontologies: "PW",
    apikey: bioontologyApiKey,
    pagesize: 5,
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      let pwCandidates = [];
      if (data.collection && data.collection.length > 0) {
        pwCandidates = data.collection.slice(0, 4).map((candidate) => ({
          short_form: extractLastUriSegment(candidate["@id"]),
          description: candidate["definition"]?.[0] || "",
          label: candidate["prefLabel"],
        }));
      }
      const promptPwApi = get_pw_api_prompt(term, pwCandidates);
      newTerm = await generateResponse(client, promptPwApi, modelIdentifier);
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `BioOntology API (PW) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching Pathway Ontology (PW): ${error}`);
  }
  return newTerm;
}

/**
 * Search for a term in the MeSH Ontology via BioOntology API.
 */
export async function searchMesh(
  term: string,
  client: Anthropic,
  modelIdentifier: string = "claude-3-haiku-20240307"
): Promise<string> {
  const url = "https://data.bioontology.org/search";
  const params = {
    q: term,
    ontologies: "MESH",
    apikey: bioontologyApiKey,
    pagesize: 5,
  };
  const headers = { Accept: "application/json" };

  let newTerm = "None";
  try {
    const apiResponse: AxiosResponse = await axios.get(url, {
      headers,
      params,
    });

    if (apiResponse.status === 200) {
      const data = apiResponse.data;
      let meshCandidates = [];
      if (data.collection && data.collection.length > 0) {
        meshCandidates = data.collection.slice(0, 4).map((candidate) => ({
          short_form: extractLastUriSegment(candidate["@id"]),
          description: candidate["definition"]?.[0] || "",
          label: candidate["prefLabel"],
        }));
      }
      const promptMeshApi = get_mesh_api_prompt(term, meshCandidates);
      newTerm = await generateResponse(client, promptMeshApi, modelIdentifier);
      logger.info(`new term: ${newTerm}, old term: ${term}`);
    } else {
      logger.error(
        `BioOntology API (MeSH) gave response code ${apiResponse.status}`
      );
    }
  } catch (error) {
    logger.error(`Error searching MeSH: ${error}`);
  }
  return newTerm;
}

// --- Existing Update Functions ---
// (Keeping these as they were, as per your request to only add new search functions)

/**
 * Update subject and object fields in GO data with best-matching GO terms.
 */
export async function updateGoTerms(data: any[], client: Anthropic) {
  for (const entry of data) {
    if (entry.subject) {
      const subjectResult = await searchGo(entry.subject, client);
      entry.subject = { term: entry.subject, id: subjectResult };
    }
    if (entry.object) {
      const objectResult = await searchGo(entry.object, client);
      entry.object = { term: entry.object, id: objectResult };
    }
  }
  return data.filter(
    (entry) =>
      (entry.subject?.id !== "None" || !entry.subject) &&
      (entry.object?.id !== "None" || !entry.object)
  );
}

/**
 * Update disease fields in DOID data with best-matching DOID terms.
 */
export async function updateDoidTerms(data: any[], client: Anthropic) {
  for (const entry of data) {
    if (entry.disease) {
      const diseaseResult = await searchDoid(entry.disease, client);
      entry.disease_id = diseaseResult;
    }
  }
  return data.filter((entry) => entry.disease_id !== "None" || !entry.disease);
}

/**
 * Update compound fields in ChEBI data with best-matching ChEBI terms.
 */
export async function updateChebiTerms(data: any[], client: Anthropic) {
  for (const entry of data) {
    if (entry.compound) {
      const compoundResult = await searchChebi(entry.compound, client);
      entry.compound_id = compoundResult;
    }
  }
  return data.filter(
    (entry) => entry.compound_id !== "None" || !entry.compound
  );
}

/**
 * Update drug fields in ATC data with best-matching ATC terms.
 */
export async function updateAtcTerms(data: any[], client: Anthropic) {
  for (const entry of data) {
    if (entry.drug) {
      const drugResult = await searchAtc(entry.drug, client);
      entry.drug_id = drugResult;
    }
  }
  return data.filter((entry) => entry.drug_id !== "None" || !entry.drug);
}
