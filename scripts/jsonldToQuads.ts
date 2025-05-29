import { Quad, Store } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
import axios from "axios";
import fs from "fs";
import path from "path";

async function processJsonLdFile(filePath: string) {
  const store = new Store();
  const parser = new JsonLdParser();
  const jsonLdString = fs.readFileSync(filePath, "utf-8");

  // Parse JSON to extract @id for graph
  let graphId: string;
  try {
    const jsonData = JSON.parse(jsonLdString);
    graphId = jsonData["@id"];
    if (!graphId) {
      throw new Error(`No @id found in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error extracting @id from ${filePath}:`, error);
    throw error;
  }

  return new Promise((resolve, reject) => {
    try {
      parser.on("data", (quad) => {
        store.addQuad(quad);
      });

      parser.on("error", (error) => {
        console.error(`Parsing error in ${filePath}:`, error);
        reject(error);
      });

      parser.on("end", async () => {
        console.log(`\nProcessing ${path.basename(filePath)}:`);
        console.log(`Parsed ${store.size} quads`);

        // Convert store to N-Quads format (same logic as N-Triples but with graph)
        const nquads = store
          .getQuads(null, null, null, null)
          .map(
            (quad) =>
              `<${quad.subject.value}> <${quad.predicate.value}> ${
                quad.object.termType === "Literal"
                  ? `"${quad.object.value}"`
                  : `<${quad.object.value}>`
              } <${graphId}>.`
          )
          .join("\n");

        try {
          // Store in Oxigraph
          const response = await axios.post(
            "http://localhost:7878/store",
            nquads,
            {
              headers: {
                "Content-Type": "application/n-quads",
              },
            }
          );

          if (response.status === 204) {
            console.log(
              `Successfully stored ${path.basename(filePath)} in Oxigraph`
            );
            resolve(true);
          }
        } catch (error) {
          console.error(
            `Error storing ${path.basename(filePath)} in Oxigraph:`,
            nquads
          );
          reject(error);
        }
      });

      parser.write(jsonLdString);
      parser.end();
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
      reject(error);
    }
  });
}

async function main() {
  const outputDir = path.join(process.cwd(), "markoJSONLDs");
  const files = fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith(".json"));

  console.log(`Found ${files.length} JSON-LD files to process`);

  for (const file of files) {
    const filePath = path.join(outputDir, file);
    try {
      await processJsonLdFile(filePath);
    } catch (error) {
      console.error(`Failed to process ${file}:`, error.response.data);
    }
  }

  console.log("\nProcessing complete!");
}

main().catch(console.error);
