// prompts.ts

import {
  basic_info_example_input,
  basic_info_example_output,
  citations_example_input,
  citations_example_output,
  subgraph_go_example_input,
  subgraph_go_example_output,
  subgraph_doid_example_input,
  subgraph_doid_example_output,
  subgraph_chebi_example_input,
  subgraph_chebi_example_output,
  subgraph_atc_example_input,
  subgraph_atc_example_output,
  example_basic_info,
  example_spar_output,
  example_go_output,
  example_doid_output,
  example_chebi_output,
  gene_ontology_example_input,
  doid_ontology_example_input,
  chebi_ontology_example_input,
  example_json_citations,
  example_graph,
  incorrect_json_example,
  correct_json_example,
} from "./exampleForPrompts";

/**
 * Returns a prompt for choosing the most appropriate Gene Ontology (GO) term
 * from a list of GO candidates.
 */
export function get_go_api_prompt(term: string, go_candidates): string {
  return `
    Given the biological context, which of the following Gene Ontology (GO) terms best matches the description for '${term}'? Please select the most appropriate GO term or indicate if none apply by replying 'None'.

    GO Candidates in JSON format: ${JSON.stringify(go_candidates)}

    You must output the GO candidate which is the most suitable by replying with its id (e.g. 'GO_0043178'). If there are no suitable candidates output 'None'.
    MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'. THE ID MUST BE IN FORMAT "GO_NUMBER" - USE "_" ALWAYS. DO NOT OUTPUT ANYTHING ELSE
    `;
}

/**
 * Returns a prompt for choosing the most appropriate Disease Ontology (DOID) term
 * from a list of DOID candidates.
 */
export function get_doid_api_prompt(term: string, doid_candidates): string {
  return `
    Given the biological context, which of the following Disease Ontology (DOID) terms best matches the description for '${term}'? Please select the most appropriate DOID term or indicate if none apply by replying 'None'.

    DOID Candidates in JSON format: ${JSON.stringify(doid_candidates)}

    You must output the DOID candidate which is the most suitable by replying with its id (e.g. 'DOID_14330'). If there are no suitable candidates output 'None'.
    MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'. THE ID MUST BE IN FORMAT "DOID_NUMBER" - USE "_" ALWAYS. DO NOT OUTPUT ANYTHING ELSE
    `;
}

/**
 * Returns a prompt for choosing the most appropriate ChEBI term
 * from a list of ChEBI candidates.
 */
export function get_chebi_api_prompt(term: string, chebi_candidates): string {
  return `
    Given the biological context, which of the following Chemical Entities of Biological Interest (ChEBI) terms best matches the description for '${term}'? Please select the most appropriate ChEBI term or indicate if none apply by replying 'None'.

    ChEBI Candidates in JSON format: ${JSON.stringify(chebi_candidates)}

    You must output the ChEBI candidate which is the most suitable by replying with its id (e.g. 'CHEBI_15377'). If there are no suitable candidates output 'None'.
    MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'. THE ID MUST BE IN FORMAT "CHEBI_NUMBER" - USE "_" ALWAYS. DO NOT OUTPUT ANYTHING ELSE.
    `;
}

/**
 * Returns a prompt for choosing the most appropriate ATC term
 * from a list of ATC candidates.
 */
export function get_atc_api_prompt(term: string, atc_candidates): string {
  return `
    Given the biological context, which of the following Anatomical Therapeutic Chemical (ATC) terms best matches the description for '${term}'? Please select the most appropriate ATC term or indicate if none apply by replying 'None'.

    ATC Candidates in JSON format: ${JSON.stringify(atc_candidates)}

    You must output the ATC candidate which is the most suitable by replying with its id (e.g. 'A14AA04'). If there are no suitable candidates, output 'None'.
    MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'.
    `;
}

/**
 * Returns a prompt for choosing the most appropriate Mondo term
 * from a list of Mondo candidates.
 */
export function get_mondo_api_prompt(term: string, mondo_candidates): string {
  return `
      Given the biological context, which of the following Mondo Disease Ontology terms best matches the description for '${term}'? Please select the most appropriate Mondo term or indicate if none apply by replying 'None'.
  
      Mondo Candidates in JSON format: ${JSON.stringify(mondo_candidates)}
  
      You must output the Mondo candidate which is the most suitable by replying with its id (e.g. 'MONDO_0005015'). If there are no suitable candidates output 'None'.
      MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'. THE ID MUST BE IN FORMAT "MONDO_NUMBER" - USE "_" ALWAYS. DO NOT OUTPUT ANYTHING ELSE.
      `;
}

/**
 * Returns a prompt for choosing the most appropriate ECO term
 * from a list of ECO candidates.
 */
export function get_eco_api_prompt(term: string, eco_candidates): string {
  return `
      Given the biological context, which of the following Evidence & Conclusion Ontology (ECO) terms best matches the description for '${term}'? Please select the most appropriate ECO term or indicate if none apply by replying 'None'.
  
      ECO Candidates in JSON format: ${JSON.stringify(eco_candidates)}
  
      You must output the ECO candidate which is the most suitable by replying with its id (e.g. 'ECO_0000006'). If there are no suitable candidates output 'None'.
      MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'. THE ID MUST BE IN FORMAT "ECO_NUMBER" - USE "_" ALWAYS. DO NOT OUTPUT ANYTHING ELSE.
      `;
}

/**
 * Returns a prompt for choosing the most appropriate Pathway Ontology (PW) term
 * from a list of PW candidates.
 */
export function get_pw_api_prompt(term: string, pw_candidates): string {
  return `
      Given the biological context, which of the following Pathway Ontology (PW) terms best matches the description for '${term}'? Please select the most appropriate PW term or indicate if none apply by replying 'None'.
  
      PW Candidates in JSON format: ${JSON.stringify(pw_candidates)}
  
      You must output the PW candidate which is the most suitable by replying with its id (e.g. 'PW_0001059'). If there are no suitable candidates, output 'None'.
      MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'.
      `;
}

/**
 * Returns a prompt for choosing the most appropriate MeSH term
 * from a list of MeSH candidates.
 */
export function get_mesh_api_prompt(term: string, mesh_candidates): string {
  return `
      Given the biological context, which of the following Medical Subject Headings (MeSH) terms best matches the description for '${term}'? Please select the most appropriate MeSH term or indicate if none apply by replying 'None'.
  
      MeSH Candidates in JSON format: ${JSON.stringify(mesh_candidates)}
  
      You must output the MeSH candidate which is the most suitable by replying with its id (e.g. 'D008881'). If there are no suitable candidates, output 'None'.
      MAKE SURE TO ONLY OUTPUT THE MOST SUITABLE ID OR 'None'.
      `;
}

/**
 * Returns a prompt for extracting basic paper info (title, authors, abstract, etc.)
 * from an array of paper JSON chunks.
 */
export function get_prompt_basic_info(paper_array): string {
  return `**Prompt**:
    You are provided with chunks of a scientific paper in the form of JSON array elements, each containing parts of the paper such as potential titles, authors, and abstracts. Your task is to analyze these chunks incrementally to update and output the information listed below. If an element contains relevant information that improves upon or adds to the current data, update the respective fields; otherwise.

    **Task**
    1. Capture the title of the paper if a more accurate title is found in the chunk.
    2. Identify the authors list, refining or appending to the current list based on the new information found in the chunk. MAKE SURE TO USE FULL NAMES OF THE AUTHORS AND INCLUDE THEM ALL!
    3. Identify the abstract if more detailed or relevant information is provided in the chunk.
    4. Identify the publication date if found in any of the chunks.
    5. Identify the publisher or journal name if it can be extracted from the given data.
    6. Identify the volume and issue number of the journal in which the paper is published.
    7. Identify the page numbers that indicate where the paper is located within the journal.
    8. Identify the DOI (Digital Object Identifier) which provides a persistent link to the paper's online location.
    9. Capture key experimental details such as:
        OBI_0000299 'has_specified_output': Describe the types of data or results produced by the research.
        OBI_0000968 'instrument': Specify the instruments or equipment used in the research.
        OBI_0000293 'has_specified_input': Identify inputs such as samples or data sets utilized in the study.
        OBI_0200000 'data transformation': Explain any computational or analytical methods applied to raw data.
        OBI_0000251 'recruitment status': For clinical studies, provide details on the status of participant recruitment.
        OBI_0000070 'assay': Describe the specific assays used in the study to measure or observe biological, chemical, or physical processes, essential for validating the experimental hypothesis and ensuring reproducibility.
        IAO_0000616 'conflict of interest': If there's a conflict of interest mentioned in the paper, describe it here.

    **Example Input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${basic_info_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${basic_info_example_output}

    Proceed with the analysis based on the structure and instructions provided in this prompt.

    **Actual paper array input**
    ${JSON.stringify(paper_array)}

    ** MAKE SURE TO INCLUDE THE TITLE, FULL AUTHOR LIST WITH THEIR FULL NAMES, ABSTRACT AND ALL OTHER INFORMATION ABOUT THE PAPER IN A JSON OBJECT, DO NOT INCLUDE ANY EXPLANATIONS OR ADDITIONAL CONTENT **
    `;
}

/**
 * Returns a prompt for extracting citation info from the last pages of a paper.
 */
export function get_prompt_citations(paper_array): string {
  return `**Prompt**:
    Analyze the provided chunks of the final few pages of a scientific paper formatted as JSON array elements. Each element contains potential citations, likely preceded by the term 'References'.

    **Task**:
    1. Carefully examine each citation to ensure that none are omitted. Every citation found in the input must be included.
    2. Extract and return each citation, splitting each by a new line. Each citation should include the first author's name, the title and DOI URL identifier of the cited paper. 
    3. Confirm completeness by ensuring that every potential citation found in the input is included.

    **Instructions**:
    - Begin your examination from the section likely marked by 'References', as this is where citations typically start.
    - Ensure completeness by including every citation identified in the input. Do not skip any citations.
    - Output should consist only of the first author of the paper, the title and DOI URL of each citation, formatted as 'First author, title - DOI'.
    - Provide the citations as a simple list, each on a new line, adhering strictly to the format provided below. Do not include any other comments or remarks.

    **Example Input Format (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**:
    ${citations_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**:
    ${citations_example_output}

    **Actual Input to analyze**:
    ${JSON.stringify(paper_array)}

    **Final instruction**
    Provide me with the final output of citations, making sure to include the author and title of the cited paper and DOI in 'author, cited paper title - DOI' format, separating each citation by a new line.
    `;
}

/**
 * Returns a prompt for extracting Gene Ontology (GO) relationships from a parsed paper.
 */
export function get_prompt_go_subgraph(paper_array): string {
  return `**Prompt**:
    You are provided with a parsed scientific paper in the form of a JSON array. Analyze this array to extract relationships using Gene Ontology (GO) terms and identifiers based on the scientific analysis conducted within the paper. Utilize only the recognized relationships in the Gene Ontology, which include: "is_a", "part_of", "regulates", "positively_regulates", "negatively_regulates", "occurs_in", "capable_of", "capable_of_part_of", "has_part", "has_input", "has_output", "derives_from", and "derives_into". Each extracted relationship should be accompanied by a brief explanation that clarifies the relationship within the context of the scientific findings.

    Structure your response as a JSON array containing objects. Each object should have the following properties:

    subject: The GO term or identifier that acts or is described.
    predicate: The relationship from the Gene Ontology, only choosing from the following: "is_a", "part_of", "regulates", "positively_regulates", "negatively_regulates", "occurs_in", "capable_of", "capable_of_part_of", "has_part", "has_input", "has_output", "derives_from", and "derives_into".
    object: The GO term or identifier that is acted upon or described.
    explanation: A brief explanation of the relationship, indicating its relevance and context.

    **Example Input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_go_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_go_example_output}

    Proceed with the analysis based on the structure and instructions provided in this prompt. MAKE SURE TO ONLY CREATE GENE ONTOLOGY TERMS THAT ACTUAL EXIST AND ARE SUPPORTED BY THE ONTOLOGY. MAKE SURE TO ONLY USE THE RELATIONSHIPS THAT I PROVIDED.

    **Actual paper array input**
    ${JSON.stringify(paper_array)}

    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY OF THE GENE ONTOLOGY IDENTIFIERS AND RELATIONSHIPS FROM THE ANALYZED PAPER. DO NOT ADD ANY ADDITIONAL REMARKS OR COMMENTS ASIDE OF THE JSON ARRAY. **
    `;
}

/**
 * Returns a prompt for extracting disease relationships from a parsed paper
 * using DOID (Disease Ontology).
 */
export function get_prompt_doid_subgraph(paper_array): string {
  return `**Prompt**:
    You are provided with a parsed scientific paper in the form of a JSON array. Analyze this array to extract diseases and findings about them using Human Disease Ontology (DOID) terms and identifiers based on the scientific analysis conducted within the paper.

    Structure your response as a JSON array containing objects. Each object should have the following properties:

    disease: Name of the disease, or group of diseases that you extracted
    findings: Description of the disease and findings in the paper about the disease or group of diseases.

    **Example Input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_doid_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_doid_example_output}

    Proceed with the analysis based on the structure and instructions provided in this prompt. MAKE SURE TO ONLY CREATE DOID ONTOLOGY TERMS AND FINDINGS ABOUT THEM THAT ACTUAL EXIST AND ARE SUPPORTED BY THE ONTOLOGY. MAKE SURE TO ONLY USE THE FORMAT THAT I PROVIDED.

    **Actual paper array input**
    ${JSON.stringify(paper_array)}

    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY OF THE DOID DISEASE NAMES AND FINDINGS FROM THE ANALYZED PAPER. DO NOT ADD ANY ADDITIONAL REMARKS OR COMMENTS ASIDE OF THE JSON ARRAY. **
    ** MAKE SURE TO ONLY ONLY DOUBLE QUOTES INSIDE OF THE JSON ARRAY, NOT SINGLE QUOTES **
    `;
}

/**
 * Returns a prompt for extracting chemical compound relationships from a parsed paper
 * using ChEBI (Chemical Entities of Biological Interest).
 */
export function get_prompt_chebi_subgraph(paper_array): string {
  return `**Prompt**:
    You are provided with a parsed scientific paper in the form of a JSON array. Analyze this array to extract chemical compounds and findings about them using Chemical Entities of Biological Interest (ChEBI) terms and identifiers based on the scientific analysis conducted within the paper.

    Structure your response as a JSON array containing objects. Each object should have the following properties:

    compound: Name of the chemical compound, or group of compounds that you extracted
    findings: Description of the compound and findings in the paper about the compound or group of compounds.

    **Example Input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_chebi_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_chebi_example_output}

    Proceed with the analysis based on the structure and instructions provided in this prompt. MAKE SURE TO ONLY CREATE ChEBI ONTOLOGY TERMS AND FINDINGS ABOUT THEM THAT ACTUALLY EXIST AND ARE SUPPORTED BY THE ONTOLOGY. MAKE SURE TO ONLY USE THE FORMAT THAT I PROVIDED.

    **Actual paper array input**
    ${JSON.stringify(paper_array)}

    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY OF THE ChEBI COMPOUND NAMES AND FINDINGS FROM THE ANALYZED PAPER. DO NOT ADD ANY ADDITIONAL REMARKS OR COMMENTS ASIDE OF THE JSON ARRAY. **
    ** MAKE SURE TO ONLY ONLY DOUBLE QUOTES INSIDE OF THE JSON ARRAY, NOT SINGLE QUOTES **
     `;
}

/**
 * Returns a prompt for extracting medication relationships from a parsed paper
 * using the ATC (Anatomical Therapeutic Chemical) classification.
 */
export function get_prompt_atc_subgraph(paper_array): string {
  return `**Prompt**:
    You are provided with a parsed scientific paper in the form of a JSON array. Analyze this array to extract medications and findings about them using Anatomical Therapeutic Chemical (ATC) terms and identifiers based on the scientific analysis conducted within the paper.

    Structure your response as a JSON array containing objects. Each object should have the following properties:

    drug: Name of the medication, or group of medications that you extracted
    findings: Description of the medication and findings in the paper about the medication or group of medications.

    **Example Input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_atc_example_input}

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${subgraph_atc_example_output}

    Proceed with the analysis based on the structure and instructions provided in this prompt. MAKE SURE TO ONLY CREATE ATC ONTOLOGY TERMS AND FINDINGS ABOUT THEM THAT ACTUALLY EXIST AND ARE SUPPORTED BY THE ONTOLOGY. MAKE SURE TO ONLY USE THE FORMAT THAT I PROVIDED.

    **Actual paper array input**
    ${JSON.stringify(paper_array)}

    ** MAKE SURE TO ONLY ONLY DOUBLE QUOTES INSIDE OF THE JSON ARRAY, NOT SINGLE QUOTES **
    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY OF THE ATC MEDICATION NAMES AND FINDINGS FROM THE ANALYZED PAPER. DO NOT ADD ANY ADDITIONAL REMARKS OR COMMENTS ASIDE OF THE JSON ARRAY. **
    `;
}

/**
 * Returns a prompt to transform citation info into SPAR-compliant JSON-LD.
 */
export function get_prompt_spar_citations(citations: string): string {
  return `
    **Task**
    Transform the provided citation information about a scientific paper into a JSON array of citations following the format I provide you.
    One citation should be represented as one object, with an "@id" field which represents the DOI URL and "dcterms:title" field which represents the title, and only the title, author name can be removed in the "dcterms:title" field.

    **Example Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    Here's an example of the JSON output object you should output. Pay specific attention that there are no authors named in the "dcterms:title" field:
    ${example_json_citations}

    **Actual Input**
    ${citations}

    **Final instruction**
    Output the JSON array in the specified format and make sure to use double quotes (") and not single quotes (') in the outputted JSON. Include only the DOI URLs and paper titles, all mentioned authors can be omitted. DO NOT INCLUDE ANY ADDITIONAL REMARKS OR COMMENTS, JUST THE JSON ARRAY.
    `;
}

/**
 * Returns a prompt to transform basic paper info into a SPAR/OBI-based JSON-LD.
 */
export function get_prompt_spar_ontology(basic_info_text: string): string {
  return `
    ** Task: **
    Transform the provided basic information about a scientific paper into a JSON-LD object using appropriate elements from the SPAR Ontologies. The input includes key metadata such as title, authors, abstract, and other publication details. Your task is to utilize the FaBiO, CiTO, DoCO, and PRO ontologies to create a rich, semantically detailed representation of the paper.

    ** Input **
    A JSON object with basic metadata about a scientific paper.

    ** Output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT) **
    A JSON-LD formatted object using SPAR Ontologies and OBI ontology to structure and link the provided information in a semantic web-friendly manner. Exclude attributes with no tangible values.

    **Explanation of Key OBI Elements to Include:**
    - **OBI:0000299 'has_specified_output'**: Use this to describe the types of data or results produced by the research.
    - **OBI_0000968 'instrument'**: Detail the instruments or equipment employed in the research.
    - **OBI_0000293 'has_specified_input'**: Identify inputs such as samples or data sets used in the study.
    - **OBI_0200000 'data transformation'**: Describe any computational or analytical methods applied to raw data.
    - **OBI:0000251 'recruitment status'**: Relevant for clinical studies, detail the status of participant recruitment.
    - **OBI:0000070 'assay'**: Represents the specific assays used in the study to measure or observe biological, chemical, or physical processes. Assays are fundamental in validating the experimental hypothesis and are essential for the reproducibility of the results.
    ** Note for OBI Elements ** MAKE SURE TO ONLY INCLUDE THE OBI ELEMENTS IF THEY ARE FOUND INSIDE THE SCIENCE PAPER. IF THEY ARE NOT, YOU CAN OMIT THEM.

    ** Example Input JSON **
    Basic paper info example: ${example_basic_info}

    ** Note ** Make sure not to blindly copy from the input example. It is just presented to you so you can understand the format of the data.

    ** Example Output JSON-LD (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT) **
    ${example_spar_output}

    ** Note **
    The example output is provided to you so you can understand the format of the data. MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD.
    Make sure to not include attributes in JSON LD which have no tangible values (e.g. )

    **Explanation:**
    - **@context:** Includes namespaces for a broader range of SPAR ontologies and the OBI ontology
    - **@type:** Changed to \`fabio:ResearchPaper\` to better match academic publications.
    - **DOI:** Use the dcterms:identifier field to include the DOI (Digital Object Identifier) that you found in the paper.
    - **Metadata Fields:** Extended to potentially include roles and document components.
    - **Use of PRO and DoCO:** Added placeholders for document parts (\`doco:hasPart\`) and roles (\`pro:roleIn\`).
    - **Condition on Non-Empty Values:** Fields with empty strings, empty lists, or other unspecified values are not included in the output.
    - **Flexibility in Attribute Selection:** While the example output provides a baseline, additional SPAR attributes should be considered and included if they provide further context or detail to the representation of the paper.

    ** Actual Input JSON **
    Basic paper info (SPAR & OBI Ontology): ${basic_info_text}

    ** MAKE SURE TO ONLY OUTPUT THE JSON OBJECT WHICH REPRESENTS THE JSON LD REPRESENTATION OF THE PAPERS BASIC INFO. DO NOT INCLUDE ANY OTHER REMARKS - JUST THE JSON OBJECT. DO NOT INCLUDE ANY COMMENTS IN THE JSON OUTPUT (// notation) **
    ** MAKE SURE TO ONLY INCLUDE OBI TERMS IN THE OUTPUT WHICH ARE INCLUDED IN THE BASIC PAPER INFO PASSED *
    `;
}

/**
 * Returns a prompt to transform a GO subgraph into a JSON array using GO relationships.
 */
export function get_prompt_go_ontology(generated_go_subgraph): string {
  return `
    ** Task: **
    Transform the provided basic information about a scientific paper into a JSON array using appropriate elements from the Gene Ontology (GO). The input includes Gene Ontology (GO) terms in a simple JSON format which you should transfer into an array format for an RDF graph. Your task is to utilize the GO ontology to create a rich, semantically detailed representation of terms and relationships described.

    ** Input **
    A JSON object with Gene Ontology terms and relationships from a scientific paper.

    ** Output **
    A JSON formatted array using Gene Ontology to structure and link the provided information in a semantic web-friendly manner.

    ** Example Input JSON (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    Gene Ontology input example: ${gene_ontology_example_input}

    ** Note **
    Make sure not to blindly copy from the input example. It is just presented to you so you can understand the format of the data.

    ** Example Output JSON-LD (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${example_go_output}

    ** Note **
    The example output is provided to you so you can understand the format of the data. MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD.
    Make sure to not include attributes in JSON LD which have no tangible values (e.g. )

    **Explanation of how to build GO ontology array:**
    Map the Gene Ontology relationships to their correspondands from the OBI (obi:) ontology.
    enabled by <=> obi:RO_0002333
    directly positively regulates <=> obi:RO_0002629
    negatively regulated by <=> obi:RO_0002335
    causally upstream of, positive effect <=> obi:RO_0002304
    causally upstream of, negative effect <=> obi:RO_0002305
    occurs in <=> obi:BFO_0000066
    part of <=> obi:BFO_0000050
    capable of <=> obi:RO_0002215
    capable of part of <=> RO_0002216
    has input <=> obi:RO_0002233
    has output <=> obi:RO_0002234
    derives from <=> obi:RO_0001000
    derives into <=> obi:RO_0001001

    ** Actual Input JSON **
    Gene Ontology terms and relationships: ${JSON.stringify(
      generated_go_subgraph,
      null,
      2
    )}

    ** Note **
    The example output is provided to you so you can understand the format of the data - the actual output should be in the same format of only the JSON array.
    ** MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD. **
    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY WHICH REPRESENTS THE GO TERMS - NO OTHER REMARKS OR COMMENTS SHOULD BE INCLUDED **
    `;
}

/**
 * Returns a prompt to transform a DOID subgraph into a JSON array using DOID relationships.
 */
export function get_prompt_doid_ontology(generated_doid_subgraph): string {
  return `
    ** Task: **
    Transform the provided basic information about a scientific paper into a JSON array using appropriate elements from the Disease Ontology (DOID). The input includes Disease Ontology (DOID) terms in a simple JSON format which you should transfer into an array format for an RDF graph. Your task is to utilize the DOID ontology to create a rich, semantically detailed representation of terms and relationships described.

    ** Input **
    A JSON object with DOID terms and findings about the disease from a scientific paper.

    ** Output **
    A JSON formatted array using DOID ontology to structure and link the provided information in a semantic web-friendly manner.

    ** Example Input JSON (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    Disease Ontology input example: ${doid_ontology_example_input}

    ** Note **
    Make sure not to blindly copy from the input example. It is just presented to you so you can understand the format of the data.

    ** Example Output JSON-LD (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${example_doid_output}

    ** Note **
    The example output is provided to you so you can understand the format of the data. MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD.
    Make sure to not include attributes in JSON LD which have no tangible values 

    **Explanation of how to build DOID ontology array:**
    Map the provided "disease_id" to the "@id" field.
    Map the provided "disease" field to the "dcterms:title" field.
    Map the provided "findings" field to the "dcterms:description" field.

    ** Actual Input JSON **
    Disease ontology terms and relationships: ${JSON.stringify(
      generated_doid_subgraph,
      null,
      2
    )}

    ** Note **
    The example output is provided to you so you can understand the format of the data - the actual output should be in the same format of only the JSON array.
    ** MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD. **
    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY WHICH REPRESENTS THE DOID DISEASES - NO OTHER REMARKS OR COMMENTS SHOULD BE INCLUDED **
    `;
}

/**
 * Returns a prompt to transform a ChEBI subgraph into a JSON array using ChEBI relationships.
 */
export function get_prompt_chebi_ontology(generated_chebi_subgraph): string {
  return `
    ** Task: **
    Transform the provided basic information about a scientific paper into a JSON array using appropriate elements from the Chemical Entities of Biological Interest (ChEBI). The input includes ChEBI terms in a simple JSON format which you should transfer into an array format for an RDF graph. Your task is to utilize the ChEBI ontology to create a rich, semantically detailed representation of terms and relationships described.

    ** Input **
    A JSON object with ChEBI terms and findings about the chemical compound from a scientific paper.

    ** Output **
    A JSON formatted array using ChEBI ontology to structure and link the provided information in a semantic web-friendly manner.

    ** Example Input JSON (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ChEBI input example: ${chebi_ontology_example_input}

    ** Note **
    Make sure not to blindly copy from the input example. It is just presented to you so you can understand the format of the data.

    ** Example Output JSON-LD (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${example_chebi_output}

    ** Note **
    The example output is provided to you so you can understand the format of the data. MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD.
    Make sure to not include attributes in JSON LD which have no tangible values 

    **Explanation of how to build ChEBI ontology array:**
    Map the provided "compound_id" to the "@id" field.
    Map the provided "compound" field to the "dcterms:title" field.
    Map the provided "findings" field to the "dcterms:description" field.

    ** Actual Input JSON **
    Disease ontology terms and relationships: ${JSON.stringify(
      generated_chebi_subgraph,
      null,
      2
    )}

    ** Note **
    The example output is provided to you so you can understand the format of the data - the actual output should be in the same format of only the JSON array.
    ** MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE DATA FROM THE PAPER INSTEAD. **
    ** MAKE SURE TO ONLY OUTPUT THE JSON ARRAY WHICH REPRESENTS THE DOID DISEASES - NO OTHER REMARKS OR COMMENTS SHOULD BE INCLUDED **
    `;
}

/**
 * Returns a prompt asking for start and stop pages of specified sections
 * given an array of page text data.
 */
export function get_prompt_section_page_numbers(
  paper_array,
  sections: string[]
): string {
  let prompt = `Given the following pages of a research paper, identify the start and stop pages for each one of the provided sections\n\n`;

  paper_array.forEach((element) => {
    const pageNumber = element.metadata?.page_number;
    const text = element.text;
    prompt += `Page ${pageNumber}:\n${text}\n\n`;
  });

  prompt += `Please provide the start and stop pages for each section in the following format:
    
    ** Example input (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    Introduction, abstract

    ** Example output (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**:
    Introduction 1, 2
    Abstract, 4, 9

    ** Actual input **
    ${sections.join(", ")}

    ** Your output **
    ${JSON.stringify(
      sections.map((section) => `${section}, start, end`),
      null,
      2
    )}

    OUTPUT ONLY THE SECTIONS AND PAGE NUMBERS IN THE EXAMPLE FORMAT, ONLY FOR THE SECTIONS FROM THE INPUT. DO NOT CONSIDER OTHER SECTIONS OR ADD ANY OTHER COMMENTS, EXPLANATIONS ETC. 
    `;
  return prompt;
}

/**
 * Returns a prompt for generating a textual summary for similarity search
 * from an RDF JSON-LD graph.
 */
export function get_prompt_vectorization_summary(graph): string {
  // Shallow clone of the graph
  const graphCopy = JSON.parse(JSON.stringify(graph));
  if (graphCopy["cito:cites"]) {
    delete graphCopy["cito:cites"];
  }

  return `
    ** Task: **
    Generate a comprehensive textual summary based on the provided RDF JSON-LD graph. The summary should include as much information as possible that would be useful for similarity search.

    ** Input **

    An RDF JSON-LD graph that contains various nodes and relationships.

    ** Output **

    A detailed textual summary that captures the key information, entities, and relationships in the graph, formatted in a way that maximizes its utility for similarity search.

    ** Example Input JSON (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${example_graph}

    ** Example Output summary **

    The research paper titled "KSR1 Knockout Mouse Model Demonstrates MAPK Pathway's Key Role in Cisplatin- and Noise-induced Hearing Loss" was authored by Maria A. Ingersoll, Jie Zhang, and Tal Teitz and published on March 21, 2024, in the Neurobiology of Disease. This study investigates the impact of the KSR1 gene on hearing loss. The abstract reveals that knockout mice devoid of the KSR1 protein exhibit resistance to cisplatin- and noise-induced permanent hearing loss compared to their wild-type counterparts. The KSR1 protein acts as a scaffold bringing MAPK pathway proteins (BRAF, MEK1/2, ERK1/2) in proximity for activation through phosphorylation cascades triggered by cisplatin and noise in cochlear cells. The knockout of KSR1 significantly reduces MAPK activation, thereby conferring hearing protection.

    Key findings include the role of MAPK pathway inhibition in providing hearing protection, with dabrafenib (a BRAF inhibitor) effectively protecting KSR1 wild-type mice from hearing loss without additional benefits in KSR1 knockout mice. These findings suggest that dabrafenib primarily works through the MAPK pathway.

    Further details include the involvement of several key entities:
    - GO_0004672: Knockout of the KSR1 gene reduces activation of the MAPK signaling pathway, which is involved in cellular stress and death in response to cisplatin and noise exposure.
    - DOID_0050563: Genetic knockout of the KSR1 gene in mice confers resistance to noise-induced permanent hearing loss compared to wild-type littermates. KSR1 knockout mice had significantly less hearing loss, as demonstrated by auditory brainstem response, distortion product otoacoustic emission, outer hair cell counts, and synaptic puncta staining, compared to wild-type mice following noise exposure. Inhibition of the MAPK pathway, which includes BRAF, MEK, and ERK, was shown to be the mechanism by which KSR1 knockout mice were protected from noise-induced hearing loss.
    - CHEBI_75048: Dabrafenib is a BRAF inhibitor that protects against both cisplatin-induced and noise-induced hearing loss in mice by inhibiting the MAPK pathway. Dabrafenib is an FDA-approved drug, making it a promising compound to repurpose for the prevention of hearing loss.
    - L01XA01: Cisplatin is a widely used chemotherapeutic agent that can cause permanent hearing loss as a side effect. Cisplatin-induced hearing loss is associated with activation of the MAPK pathway, which leads to cellular stress and damage in the inner ear. Genetic knockout of the KSR1 gene, which is involved in the MAPK pathway, conferred resistance to cisplatin-induced hearing loss in mice. Additionally, treatment with the BRAF inhibitor dabrafenib, which inhibits the MAPK pathway, also protected against cisplatin-induced hearing loss.

    The study utilized various instruments and equipment (details not specified), and included the KSR1 knockout mouse model and wild-type littermates as subjects. Analytical methods involved single-cell RNA sequencing data from postnatal day 28 C57BL/6 mice to examine the expression of MAPK genes in the cochlea, and statistical analysis to compare hearing outcomes and MAPK signaling between KSR1 knockout and wild-type mice. Hearing function was evaluated using auditory assessments, and MAPK pathway activation in the cochlea was measured through biochemical assays.


    ** Notes **
    1. DO NOT USE ANY SPECIAL CHARACTERS IN THE SUMMARY. eg. :, ", newlines, etc.
    2. Ensure the summary captures all key entities and relationships present in the RDF JSON-LD graph.
    3. The summary should be formatted in a way that makes it easy to use for similarity search purposes - make sure to use specific term names and not pronouns such as "it", "he", "they".
    4. Your output should be only the generated summary. No other comments or remarks will be tolerated.
    ** Actual Input JSON **

    ${JSON.stringify(graphCopy, null, 4)}
    
    ** FINAL NOTE - MAKE SURE TO ONLY OUTPUT THE GENERATED SUMMARY, WITHOUT EXTRA COMMENTS OR REMARKS **
    `;
}

/**
 * Returns a prompt to convert incorrectly formatted text into valid JSON.
 */
export function get_prompt_convert_to_json(incorrect_json: string): string {
  return `
    ** Task: **
    Convert the following incorrectly formatted text into a valid JSON format. Ensure that any incomplete or cut-off elements are properly removed, and the resulting JSON structure is correct.

    ** Input: **
    The incorrectly formatted text that is supposed to be JSON but has errors or missing/extra elements.

    ** Output: **
    A valid JSON structure with all elements properly formatted and completed. If the JSON array is too long and gets cut off, delete the last incomplete element and properly close the array.

    ** Example Input JSON: **
    ${incorrect_json_example}

    ** Note: **
    Make sure not to blindly copy from the input example. It is just presented to you so you can understand the format of the data.

    ** Example Output JSON: **
    ${correct_json_example}

    ** Note: **
    The example output is provided to you so you can understand the format of the data. MAKE SURE TO NOT BLINDLY COPY DATA FROM THE OUTPUT AND ACTUALLY USE THE PROVIDED DATA INSTEAD.

    ** Actual Input JSON: **
    ${incorrect_json}

    ** Important Notes: **
    1. THE MOST IMPORTANT THING IS THAT THE JSON MUST BE CORRECT. IT IS OKAY TO REMOVE SOME OF THE CONTENT IN ORDER TO MAKE THE JSON FORMATTED WELL.
    2. REMOVE ANY INCOMPLETE ELEMENTS FROM THE JSON ARRAY AND PROPERLY CLOSE THE ARRAY.
    3. MAKE SURE TO ONLY OUTPUT THE JSON OBJECT, DO NOT INCLUDE ANY OTHER REMARKS OR COMMENTS.
    `;
}

/**
 * Returns a prompt to generate three suggested research questions
 * based on the given RDF JSON-LD graph.
 */
export function get_prompt_suggested_questions(graph): string {
  const graphCopy = JSON.parse(JSON.stringify(graph));
  if (graphCopy["cito:cites"]) {
    delete graphCopy["cito:cites"];
  }

  return `
    ** Task: **
    Generate three suggested research questions based on the provided RDF JSON-LD graph. The questions should be related to the key entities, assets, or topics in the graph and should be useful for exploring the content further.

    ** Input **

    An RDF JSON-LD graph that contains various nodes and relationships.

    ** Output **

    Three research questions related to the graph's entities and relationships. The questions should be designed to assist in exploring related assets (such as papers, entities, or authors) and can be based on the scientific content of the graph.

    ** Example Input JSON (ONLY AN EXAMPLE, DO NOT COPY DATA FROM HERE FOR ACTUAL OUTPUT)**
    ${example_graph}

    ** Example Suggested Questions **

    1. List all the science papers related to Alzheimer disease.
    2. What can you tell me about Cisplatin from the recent science papers?
    3. List me the authors of paper "KIS kinase controls alternative splicing during neuronal differentiation".

    ** Example Output (Make sure to follow this exact format, with no additional text): **

    List all the science papers related to Alzheimer disease.
    What can you tell me about Cisplatin from the recent science papers?
    List me the authors of paper "KIS kinase controls alternative splicing during neuronal differentiation".

    ** Notes **
    1. Ensure the questions are specific, well-formed, and directly related to the entities or relationships present in the RDF JSON-LD graph.
    2. The questions should be in a format that can be easily understood and processed for further querying or retrieval tasks.
    3. Your output should be the three suggested questions, each on its own line, without extra comments or remarks. Do not include any labels like 'Question:'.

    ** Actual Input JSON **

    ${JSON.stringify(graphCopy, null, 4)}

    ** FINAL NOTE - MAKE SURE TO OUTPUT ONLY THE THREE QUESTIONS WITHOUT EXTRA COMMENTS OR REMARKS **
    `;
}

export const categorizeIntoDAOsPrompt = `JUST RETURN THE ARRAY OF DAO NAMES RELEVANT TO THE PAPER AND ANSWER VERY CONCISE AND TO THE POINT
<dao_list>
VitaDAO → Longevity, anti-aging, age-related diseases
AthenaDAO → Women's health, reproductive health, gynecological research
PsyDAO → Psychedelic science, mental health, psychedelic-assisted therapy
ValleyDAO → Synthetic biology, environmental biotech, climate solutions
HairDAO → Hair loss treatment, regenerative medicine, dermatology
CryoDAO → Cryopreservation, biostasis, organ/brain freezing technologies
Cerebrum DAO → Brain health, neurodegeneration, Alzheimer's research
Curetopia → Rare disease research, genetic disorders, orphan drug discovery
Long COVID Labs → Long COVID, post-viral syndromes, chronic illness research
Quantum Biology DAO → Quantum biology, biophysics, quantum effects in biology
</dao_list>

Return your output **only** as a JSON array of DAO names. If no DAOs are relevant, return an empty array.

Example output format:
["DAO1", "DAO2", "DAO3"]
or
[]`;
