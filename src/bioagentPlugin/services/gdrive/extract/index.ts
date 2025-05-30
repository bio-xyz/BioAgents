import Config from "./config";
import path from "path";
import { PaperSchema, OntologiesSchema } from "./z";
import { ontologiesExtractionPrompt, extractionPrompt } from "./prompts";
import { OpenAIImage } from "./types";
import { categorizeIntoDAOsPrompt } from "../../kaService/v1/llmPrompt";

const __dirname = path.resolve();

async function extractPaper(images: OpenAIImage[]) {
  console.log(
    `[extractPaper] Starting paper extraction with ${images.length} images`
  );
  const client = Config.instructorOai;

  // TODO: aside of images we could get some data from the internet or OpenAlex, like citations

  const { _meta, ...paper } = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: extractionPrompt,
      },
      {
        role: "user",
        content: [...images],
      },
    ],
    response_model: { schema: PaperSchema, name: "Paper" },
    max_retries: 3,
  });
  console.log(`[extractPaper] Paper extraction completed successfully`);
  return paper;
}

async function extractOntologies(images: OpenAIImage[]) {
  console.log(
    `[extractOntologies] Starting ontologies extraction with ${images.length} images`
  );
  const client = Config.instructorOai;

  const { _meta, ...ontologies } = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: ontologiesExtractionPrompt,
      },
      {
        role: "user",
        content: [...images],
      },
    ],
    // TODO: this is incorrect, 'ontologies' doesn't belong to any ontology
    response_model: { schema: OntologiesSchema, name: "Ontologies" },
    max_retries: 3,
  });
  console.log(
    `[extractOntologies] Ontologies extraction completed successfully`
  );

  // TODO: check if the ontologies match to real world examples, consider using a model with search
  return ontologies;
}

export async function categorizeIntoDAOsString(abstract: string) {
  console.log(`[categorizeIntoDAOsString] Abstract: ${abstract}`);

  const client = Config.instructorOai;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: categorizeIntoDAOsPrompt,
      },
      {
        role: "user",
        content: abstract,
      },
    ],
    max_tokens: 250,
  });
  return response.choices[0].message.content;
}

export async function generateKa(images: OpenAIImage[]) {
  console.log(
    `[generateKa] Starting knowledge extraction with ${images.length} images`
  );
  const res = await Promise.all([
    extractPaper(images),
    extractOntologies(images),
  ]);
  console.log(`[generateKa] All extractions completed, combining results`);
  res[0]["ontologies"] = res[1]["ontologies"];
  console.log(`[generateKa] Knowledge extraction successfully completed`);

  const relatedDAOsString = await categorizeIntoDAOsString(
    [
      res[0]["dcterms:abstract"],
      res[0]["dcterms:title"],
      JSON.stringify(res[0]["schema:keywords"]),
    ].join("\n")
  );

  console.log(`[generateKa] Related DAOs: ${relatedDAOsString}`);

  const daos = JSON.parse(relatedDAOsString);

  const daoUalsMap = daos.map((dao) => {
    const daoUal = daoUals[dao];
    return {
      "@id": daoUal,
      "@type": "schema:Organization",
      "schema:name": dao,
    };
  });
  res[0]["schema:relatedTo"] = daoUalsMap;

  return res[0];
}

const daoUals = {
  VitaDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101956",
  AthenaDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101957",
  PsyDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101958",
  ValleyDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101959",
  HairDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101961",
  CryoDAO:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101962",
  "Cerebrum DAO":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101963",
  Curetopia:
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101964",
  "Long Covid Labs":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101965",
  "Quantum Biology DAO":
    "did:dkg:base:84532/0xd5550173b0f7b8766ab2770e4ba86caf714a5af5/101966",
};
