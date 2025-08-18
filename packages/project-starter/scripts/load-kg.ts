import axios from 'axios';
import { Store, Quad } from 'n3';
import { JsonLdParser } from 'jsonld-streaming-parser';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_JSON_CREDENTIALS || ''),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

function graphIdFromFileName(fileName: string): string {
  // Remove .json extension and decode
  const base = fileName.replace(/\.json$/, '');
  return decodeURIComponent(base);
}

async function graphExists(graphId: string, oxigraphUrl: string): Promise<boolean> {
  const query = `ASK WHERE { GRAPH <${graphId}> { ?s ?p ?o } }`;
  const response = await axios.post(
    `${oxigraphUrl.replace(/\/$/, '')}/query`,
    `query=${encodeURIComponent(query)}`,
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
  return response.data.boolean === true;
}

async function processJsonLdFile(fileId: string, fileName: string) {
  const oxigraphUrl = process.env.OXIGRAPH_URL || 'http://localhost:7878';
  const graphId = graphIdFromFileName(fileName);

  // 1. Check if graph exists before downloading
  if (await graphExists(graphId, oxigraphUrl)) {
    console.log(`Graph ${graphId} already exists, skipping ${fileName}`);
    return;
  }

  // 2. Download file from Google Drive
  const response = await drive.files.get(
    {
      fileId: fileId,
      alt: 'media',
    },
    { responseType: 'arraybuffer' }
  );
  const jsonLdString = Buffer.from(response.data as ArrayBuffer).toString('utf-8');

  // 3. Parse and store
  const store = new Store();
  const parser = new JsonLdParser();

  return new Promise((resolve, reject) => {
    // @ts-ignore
    parser.on('data', (quad: Quad) => {
      store.addQuad(quad);
    });

    parser.on('error', (error) => {
      console.error(`Parsing error in ${fileName}:`, error);
      reject(error);
    });

    parser.on('end', async () => {
      console.log(`\nProcessing ${fileName}:`);
      console.log(`Parsed ${store.size} quads`);

      const nquads = store
        .getQuads(null, null, null, null)
        .map(
          (quad) =>
            `<${quad.subject.value}> <${quad.predicate.value}> ${
              quad.object.termType === 'Literal'
                ? `"${quad.object.value}"`
                : `<${quad.object.value}>`
            } <${graphId}>.`
        )
        .join('\n');

      try {
        const response = await axios.post(`${oxigraphUrl.replace(/\/$/, '')}/store`, nquads, {
          headers: {
            'Content-Type': 'application/n-quads',
          },
        });
        if (response.status === 204) {
          console.log(`Successfully stored ${fileName} in Oxigraph`);
          resolve(true);
        }
      } catch (error) {
        console.error(`Error storing ${fileName} in Oxigraph:`, nquads);
        reject(error);
      }
    });

    parser.write(jsonLdString);
    parser.end();
  });
}

async function main() {
  const folderId = process.env.KG_GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('KG_GOOGLE_DRIVE_FOLDER_ID not set in environment variables');
  }

  let nextPageToken: string | undefined;
  // @ts-ignore
  const allFiles: google.drive_v3.Schema$File[] = [];

  // List all JSON files in the specified folder using pagination
  do {
    const fileList = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/json'`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 1000,
      pageToken: nextPageToken,
    });

    const files = fileList.data.files || [];
    allFiles.push(...files);
    // @ts-ignore
    nextPageToken = fileList.data.nextPageToken;
  } while (nextPageToken);

  console.log(`Found ${allFiles.length} JSON-LD files to process`);

  for (const file of allFiles) {
    try {
      await processJsonLdFile(file.id!, file.name!);
    } catch (error: any) {
      console.error(`Failed to process ${file.name}:`, error.response?.data || error.message);
    }
  }

  console.log('\nProcessing complete!');
}

main().catch(console.error);
