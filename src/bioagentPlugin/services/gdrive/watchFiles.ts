import { IAgentRuntime, logger } from "@elizaos/core";
import { initDriveClient, getListFilesQuery } from "./client.js";
import { drive_v3 } from "googleapis";
import { fileURLToPath } from "url";
import { dirname } from "path";
import DKG from "dkg.js";
import { fromBuffer } from "pdf2pic";
import { pdf2PicOptions } from "./index.js";
import { OpenAIImage } from "./extract/types.js";
import { generateKa } from "./extract/index.js";
import { storeJsonLd } from "./storeJsonLdToKg.js";
import { db, fileMetadataTable } from "src/db";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import "dotenv/config";

type Schema$File = drive_v3.Schema$File;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type DKGClient = typeof DKG | null;
let DkgClient: DKGClient = null;

export interface FileInfo {
  id: string;
  name?: string;
  md5Checksum?: string;
  size?: number;
}

async function calculateMD5(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash("md5");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

export async function downloadFile(
  drive: drive_v3.Drive,
  file: FileInfo
): Promise<Buffer> {
  if (process.env.USE_GOOGLE_DRIVE === "true") {
    const res = await drive.files.get(
      {
        fileId: file.id,
        alt: "media",
      },
      {
        responseType: "arraybuffer",
        params: {
          supportsAllDrives: true,
          acknowledgeAbuse: true,
        },
        headers: {
          Range: "bytes=0-",
        },
      }
    );
    return Buffer.from(res.data as ArrayBuffer);
  } else {
    return fs.readFile(file.id);
  }
}

async function getFilesInfo(): Promise<FileInfo[]> {
  if (process.env.USE_GOOGLE_DRIVE === "true") {
    const drive = await initDriveClient();
    const query = getListFilesQuery();
    const response = await drive.files.list(query);

    return (response.data.files || [])
      .filter(
        (
          f
        ): f is Schema$File & {
          id: string;
          name: string;
          md5Checksum: string;
          size: number;
        } =>
          f.id != null &&
          f.name != null &&
          f.md5Checksum != null &&
          f.size != null
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        md5Checksum: f.md5Checksum,
        size: f.size,
      }));
  } else {
    const paperFolder = process.env.PAPER_FOLDER;
    if (!paperFolder) {
      throw new Error("PAPER_FOLDER environment variable is not set");
    }

    const files = await fs.readdir(paperFolder);
    const fileInfos: FileInfo[] = await Promise.all(
      files
        .filter((file) => file.toLowerCase().endsWith(".pdf"))
        .map(async (file) => {
          const filePath = path.join(paperFolder, file);
          const stats = await fs.stat(filePath);
          const md5Checksum = await calculateMD5(filePath);
          return {
            id: filePath,
            name: file,
            md5Checksum,
            size: stats.size,
          };
        })
    );
    return fileInfos;
  }
}

export async function watchFolderChanges(runtime: IAgentRuntime) {
  logger.info(
    `Watching ${
      process.env.USE_GOOGLE_DRIVE === "true"
        ? "Google Drive"
        : `local folder: ${process.env.PAPER_FOLDER}`
    } for changes`
  );

  DkgClient = new DKG({
    environment: runtime.getSetting("DKG_ENVIRONMENT"),
    endpoint: runtime.getSetting("DKG_HOSTNAME"),
    port: runtime.getSetting("DKG_PORT"),
    blockchain: {
      name: runtime.getSetting("DKG_BLOCKCHAIN_NAME"),
      publicKey: runtime.getSetting("DKG_PUBLIC_KEY"),
      privateKey: runtime.getSetting("DKG_PRIVATE_KEY"),
    },
    maxNumberOfRetries: 300,
    frequency: 2,
    contentType: "all",
    nodeApiVersion: "/v1",
  });

  let knownHashes = new Set<string>();

  // Load existing processed file hashes from database
  let response = await db
    .select({ hash: fileMetadataTable.hash })
    .from(fileMetadataTable);
  for (const file of response) {
    knownHashes.add(file.hash);
  }

  const drive =
    process.env.USE_GOOGLE_DRIVE === "true" ? await initDriveClient() : null;
  let intervalId: NodeJS.Timeout | null = null;
  let isRunning = true;

  const processFile = async (file: FileInfo) => {
    logger.info(`Processing ${file.name}...`);
    const pdfBuffer = await downloadFile(drive, file);
    logger.info(`Successfully downloaded ${file.name}`);

    // Add hash to known hashes immediately to prevent duplicate processing
    knownHashes.add(file.md5Checksum!);

    const converter = fromBuffer(pdfBuffer, pdf2PicOptions);
    const storeHandler = await converter.bulk(-1, {
      responseType: "base64",
    });
    const images: OpenAIImage[] = storeHandler
      .filter((page) => page.base64)
      .map((page) => ({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${page.base64}`,
        },
      }));

    const ka = await generateKa(images);
    const res = await storeJsonLd(ka);
    if (!res) {
      return;
    } else {
      logger.info("Successfully stored JSON-LD to Oxigraph");

      // Optionally store JSON in configured output folder if env var is present
      if (process.env.JSONLD_OUTPUT_FOLDER) {
        const outputDir = path.resolve(
          process.cwd(),
          process.env.JSONLD_OUTPUT_FOLDER
        );
        try {
          await fs.access(outputDir);
        } catch {
          await fs.mkdir(outputDir, { recursive: true });
        }
        const safeId = encodeURIComponent(ka["@id"]);
        const fileName = `${safeId}.json`;
        const filePath = path.join(outputDir, fileName);

        await fs.writeFile(filePath, JSON.stringify(ka, null, 2), "utf-8");
        logger.info(`Saved KA JSON to ${filePath}`);
      }

      // Store file metadata in database after successful processing
      await db
        .insert(fileMetadataTable)
        // @ts-ignore
        .values({
          id: file.id as string,
          hash: file.md5Checksum as string,
          fileName: file.name as string,
          fileSize: Number(file.size),
          status: "processed",
        })
        .onConflictDoUpdate({
          target: fileMetadataTable.hash,
          set: {
            fileName: file.name as string,
            // @ts-ignore
            fileSize: Number(file.size),
            modifiedAt: new Date(),
            id: file.id as string,
            status: "processed",
          },
        });
    }

    try {
    } catch (error) {
      logger.error(
        "Error occurred while publishing message to DKG:",
        error.message
      );

      // Store file metadata in database after unsuccessful processing
      await db
        .insert(fileMetadataTable)
        // @ts-ignore
        .values({
          id: file.id as string,
          hash: file.md5Checksum as string,
          fileName: file.name as string,
          fileSize: Number(file.size),
          status: "failed",
        })
        .onConflictDoUpdate({
          target: fileMetadataTable.hash,
          set: {
            fileName: file.name as string,
            // @ts-ignore
            fileSize: Number(file.size),
            modifiedAt: new Date(),
            id: file.id as string,
            status: "failed",
          },
        });

      if (error.stack) {
        logger.error("Stack trace:", error.stack);
      }
      if (error.response) {
        logger.error(
          "Response data:",
          JSON.stringify(error.response.data, null, 2)
        );
      }
    }
  };

  const checkForChanges = async () => {
    if (!isRunning) return;

    console.log("Checking for changes");

    try {
      const files = await getFilesInfo();

      // Only filter by hash - if we haven't seen this content before, process it
      const newFiles = files.filter((f) => !knownHashes.has(f.md5Checksum!));

      if (newFiles.length > 0) {
        logger.info(
          "New files detected:",
          newFiles.map((f) => `${f.name} (${f.md5Checksum})`)
        );

        for (const file of newFiles) {
          await processFile(file);
        }
      }
    } catch (error) {
      logger.error("Error checking files:", error.stack);
    }
  };

  // Start checking for changes
  checkForChanges();
  intervalId = setInterval(checkForChanges, 10000); // Check every 10 seconds

  return {
    stop: () => {
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
