import type { IAgentRuntime, Route, UUID, Memory, KnowledgeItem } from '@elizaos/core';
import { MemoryType, createUniqueUuid, logger, ModelType } from '@elizaos/core';
import { KnowledgeService } from './service';
import fs from 'node:fs'; // For file operations in upload
import path from 'node:path'; // For path operations
import multer from 'multer'; // For handling multipart uploads
import { fetchUrlContent, normalizeS3Url } from './utils'; // Import utils functions

// Create multer configuration function that uses runtime settings
const createUploadMiddleware = (runtime: IAgentRuntime) => {
  const uploadDir = runtime.getSetting('KNOWLEDGE_UPLOAD_DIR') || '/tmp/uploads/';
  const maxFileSize = parseInt(runtime.getSetting('KNOWLEDGE_MAX_FILE_SIZE') || '52428800'); // 50MB default
  const maxFiles = parseInt(runtime.getSetting('KNOWLEDGE_MAX_FILES') || '10');
  const allowedMimeTypes = runtime.getSetting('KNOWLEDGE_ALLOWED_MIME_TYPES')?.split(',') || [
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/html',
    'application/json',
    'application/xml',
    'text/csv',
  ];

  return multer({
    dest: uploadDir,
    limits: {
      fileSize: maxFileSize,
      files: maxFiles,
    },
    fileFilter: (req, file, cb) => {
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `File type ${file.mimetype} not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`
          )
        );
      }
    },
  });
};

// Add this type declaration to fix Express.Multer.File error
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

// Helper to send success response
function sendSuccess(res: any, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, data }));
}

// Helper to send error response
function sendError(res: any, status: number, code: string, message: string, details?: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code, message, details } }));
}

// Helper to clean up a single file
const cleanupFile = (filePath: string) => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      logger.error(`Error cleaning up file ${filePath}:`, error);
    }
  }
};

// Helper to clean up multiple files
const cleanupFiles = (files: MulterFile[]) => {
  if (files) {
    files.forEach((file) => cleanupFile(file.path));
  }
};

// Main upload handler (without multer, multer is applied by wrapper)
async function uploadKnowledgeHandler(req: any, res: any, runtime: IAgentRuntime) {
  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(res, 500, 'SERVICE_NOT_FOUND', 'KnowledgeService not found');
  }

  // Check if the request has uploaded files or URLs
  const hasUploadedFiles = req.files && req.files.length > 0;
  const isJsonRequest = !hasUploadedFiles && req.body && (req.body.fileUrl || req.body.fileUrls);

  if (!hasUploadedFiles && !isJsonRequest) {
    return sendError(res, 400, 'INVALID_REQUEST', 'Request must contain either files or URLs');
  }

  try {
    // Process multipart requests (file uploads)
    if (hasUploadedFiles) {
      const files = req.files as MulterFile[];

      if (!files || files.length === 0) {
        return sendError(res, 400, 'NO_FILES', 'No files uploaded');
      }

      // Validate files for corruption/truncation
      const invalidFiles = files.filter((file) => {
        // Check for empty files
        if (file.size === 0) {
          logger.warn(`File ${file.originalname} is empty`);
          return true;
        }

        // Check if file has a name
        if (!file.originalname || file.originalname.trim() === '') {
          logger.warn(`File has no name`);
          return true;
        }

        // Check if file has valid path
        if (!file.path) {
          logger.warn(`File ${file.originalname} has no path`);
          return true;
        }

        return false;
      });

      if (invalidFiles.length > 0) {
        cleanupFiles(files);
        const invalidFileNames = invalidFiles.map((f) => f.originalname || 'unnamed').join(', ');
        return sendError(
          res,
          400,
          'INVALID_FILES',
          `Invalid or corrupted files: ${invalidFileNames}`
        );
      }

      // Get agentId from request body or query parameter BEFORE processing files
      // IMPORTANT: We require explicit agent ID to prevent cross-agent contamination
      const agentId = (req.body.agentId as UUID) || (req.query.agentId as UUID);

      if (!agentId) {
        logger.error('[Document Processor] ❌ No agent ID provided in upload request');
        return sendError(
          res,
          400,
          'MISSING_AGENT_ID',
          'Agent ID is required for uploading knowledge'
        );
      }

      const worldId = (req.body.worldId as UUID) || agentId;
      const chunksDbName = req.body.chunksDbName || 'knowledge';
      logger.info(`[Document Processor] 📤 Processing file upload for agent: ${agentId}`);

      const processingPromises = files.map(async (file, index) => {
        const originalFilename = file.originalname;
        const filePath = file.path;

        logger.debug(
          `[Document Processor] 📄 Processing file: ${originalFilename} (agent: ${agentId}) (chunksDbName: ${chunksDbName})`
        );

        try {
          const fileBuffer = await fs.promises.readFile(filePath);
          const base64Content = fileBuffer.toString('base64');

          // Construct AddKnowledgeOptions directly using available variables
          // Note: We no longer provide clientDocumentId - the service will generate it
          const addKnowledgeOpts: import('./types.ts').AddKnowledgeOptions = {
            agentId: agentId, // Pass the agent ID from frontend
            clientDocumentId: '' as UUID, // This will be ignored by the service
            contentType: file.mimetype, // Directly from multer file object
            originalFilename: originalFilename, // Directly from multer file object
            content: base64Content, // The base64 string of the file
            worldId,
            roomId: agentId, // Use the correct agent ID
            entityId: agentId, // Use the correct agent ID
            chunksDbName,
          };

          const result = await service.addKnowledge(addKnowledgeOpts);

          cleanupFile(filePath);

          return {
            id: result.clientDocumentId, // Use the content-based ID returned by the service
            filename: originalFilename,
            type: file.mimetype,
            size: file.size,
            uploadedAt: Date.now(),
            status: 'success',
          };
        } catch (fileError: any) {
          logger.error(
            `[Document Processor] ❌ Error processing file ${file.originalname}:`,
            fileError
          );
          cleanupFile(filePath);
          return {
            id: '', // No ID since processing failed
            filename: originalFilename,
            status: 'error_processing',
            error: fileError.message,
          };
        }
      });

      const results = await Promise.all(processingPromises);
      sendSuccess(res, results);
    }
    // Process JSON requests (URL uploads)
    else if (isJsonRequest) {
      // Accept either an array of URLs or a single URL
      const fileUrls = Array.isArray(req.body.fileUrls)
        ? req.body.fileUrls
        : req.body.fileUrl
          ? [req.body.fileUrl]
          : [];

      if (fileUrls.length === 0) {
        return sendError(res, 400, 'MISSING_URL', 'File URL is required');
      }

      // Get agentId from request body or query parameter
      // IMPORTANT: We require explicit agent ID to prevent cross-agent contamination
      const agentId = (req.body.agentId as UUID) || (req.query.agentId as UUID);
      const chunksDbName = req.body.chunksDbName || 'knowledge';

      if (!agentId) {
        logger.error('[Document Processor] ❌ No agent ID provided in URL request');
        return sendError(
          res,
          400,
          'MISSING_AGENT_ID',
          'Agent ID is required for uploading knowledge from URLs'
        );
      }

      logger.info(`[Document Processor] 📤 Processing URL upload for agent: ${agentId}`);

      // Process each URL as a distinct file
      const processingPromises = fileUrls.map(async (fileUrl: string) => {
        try {
          // Normalize the URL for storage (remove query parameters)
          const normalizedUrl = normalizeS3Url(fileUrl);

          // Remove the knowledgeId generation here - let the service handle it based on content

          // Extract filename from URL for better display
          const urlObject = new URL(fileUrl);
          const pathSegments = urlObject.pathname.split('/');
          // Decode URL-encoded characters and handle empty filename
          const encodedFilename = pathSegments[pathSegments.length - 1] || 'document.pdf';
          const originalFilename = decodeURIComponent(encodedFilename);

          logger.debug(`[Document Processor] 🌐 Fetching content from URL: ${fileUrl}`);

          // Fetch the content from the URL
          const { content, contentType: fetchedContentType } = await fetchUrlContent(fileUrl);

          // Determine content type, using the one from the server response or inferring from extension
          let contentType = fetchedContentType;

          // If content type is generic, try to infer from file extension
          if (contentType === 'application/octet-stream') {
            const fileExtension = originalFilename.split('.').pop()?.toLowerCase();
            if (fileExtension) {
              if (['pdf'].includes(fileExtension)) {
                contentType = 'application/pdf';
              } else if (['txt', 'text'].includes(fileExtension)) {
                contentType = 'text/plain';
              } else if (['md', 'markdown'].includes(fileExtension)) {
                contentType = 'text/markdown';
              } else if (['doc', 'docx'].includes(fileExtension)) {
                contentType = 'application/msword';
              } else if (['html', 'htm'].includes(fileExtension)) {
                contentType = 'text/html';
              } else if (['json'].includes(fileExtension)) {
                contentType = 'application/json';
              } else if (['xml'].includes(fileExtension)) {
                contentType = 'application/xml';
              }
            }
          }

          // Construct AddKnowledgeOptions with the fetched content
          const addKnowledgeOpts: import('./types.ts').AddKnowledgeOptions = {
            agentId: agentId, // Pass the agent ID from frontend
            clientDocumentId: '' as UUID, // This will be ignored by the service
            contentType: contentType,
            originalFilename: originalFilename,
            content: content, // Use the base64 encoded content from the URL
            worldId: agentId,
            roomId: agentId,
            entityId: agentId,
            chunksDbName,
            // Store the normalized URL in metadata
            metadata: {
              url: normalizedUrl,
            },
          };

          logger.debug(
            `[Document Processor] 📄 Processing knowledge from URL: ${originalFilename} (type: ${contentType})`
          );
          const result = await service.addKnowledge(addKnowledgeOpts);

          return {
            id: result.clientDocumentId, // Use the content-based ID returned by the service
            fileUrl: fileUrl,
            filename: originalFilename,
            message: 'Knowledge created successfully',
            createdAt: Date.now(),
            fragmentCount: result.fragmentCount,
            status: 'success',
          };
        } catch (urlError: any) {
          logger.error(`[Document Processor] ❌ Error processing URL ${fileUrl}:`, urlError);
          return {
            fileUrl: fileUrl,
            status: 'error_processing',
            error: urlError.message,
          };
        }
      });

      const results = await Promise.all(processingPromises);
      sendSuccess(res, results);
    }
  } catch (error: any) {
    logger.error('[Document Processor] ❌ Error processing knowledge:', error);
    if (hasUploadedFiles) {
      cleanupFiles(req.files as MulterFile[]);
    }
    sendError(res, 500, 'PROCESSING_ERROR', 'Failed to process knowledge', error.message);
  }
}

async function getKnowledgeDocumentsHandler(req: any, res: any, runtime: IAgentRuntime) {
  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(
      res,
      500,
      'SERVICE_NOT_FOUND',
      'KnowledgeService not found for getKnowledgeDocumentsHandler'
    );
  }

  try {
    const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 10000;
    const before = req.query.before ? Number.parseInt(req.query.before as string, 10) : Date.now();
    const includeEmbedding = req.query.includeEmbedding === 'true';
    const agentId = req.query.agentId as UUID | undefined;

    // Retrieve fileUrls if they are provided in the request
    const fileUrls = req.query.fileUrls
      ? typeof req.query.fileUrls === 'string' && req.query.fileUrls.includes(',')
        ? req.query.fileUrls.split(',')
        : [req.query.fileUrls]
      : null;

    const memories = await service.getMemories({
      tableName: 'documents',
      count: limit,
      end: before,
    });

    // Filter documents by URL if fileUrls is provided
    let filteredMemories = memories;
    if (fileUrls && fileUrls.length > 0) {
      // Normalize the URLs for comparison
      const normalizedRequestUrls = fileUrls.map((url: string) => normalizeS3Url(url));

      // Create IDs based on normalized URLs for comparison
      const urlBasedIds = normalizedRequestUrls.map((url: string) =>
        createUniqueUuid(runtime, url)
      );

      filteredMemories = memories.filter(
        (memory) =>
          urlBasedIds.includes(memory.id) || // If the ID corresponds directly
          // Or if the URL is stored in the metadata (check if it exists)
          (memory.metadata &&
            'url' in memory.metadata &&
            typeof memory.metadata.url === 'string' &&
            normalizedRequestUrls.includes(normalizeS3Url(memory.metadata.url)))
      );

      logger.debug(
        `[Document Processor] 🔍 Filtered documents by URLs: ${fileUrls.length} URLs, found ${filteredMemories.length} matching documents`
      );
    }

    const cleanMemories = includeEmbedding
      ? filteredMemories
      : filteredMemories.map((memory: Memory) => ({
          ...memory,
          embedding: undefined,
        }));
    sendSuccess(res, {
      memories: cleanMemories,
      urlFiltered: fileUrls ? true : false,
      totalFound: cleanMemories.length,
      totalRequested: fileUrls ? fileUrls.length : 0,
    });
  } catch (error: any) {
    logger.error('[Document Processor] ❌ Error retrieving documents:', error);
    sendError(res, 500, 'RETRIEVAL_ERROR', 'Failed to retrieve documents', error.message);
  }
}

async function deleteKnowledgeDocumentHandler(req: any, res: any, runtime: IAgentRuntime) {
  logger.debug(`[Document Processor] 🗑️ DELETE request for document: ${req.params.knowledgeId}`);

  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(
      res,
      500,
      'SERVICE_NOT_FOUND',
      'KnowledgeService not found for deleteKnowledgeDocumentHandler'
    );
  }

  // Get the ID directly from the route parameters
  const knowledgeId = req.params.knowledgeId;

  if (!knowledgeId || knowledgeId.length < 36) {
    logger.error(`[Document Processor] ❌ Invalid knowledge ID format: ${knowledgeId}`);
    return sendError(res, 400, 'INVALID_ID', 'Invalid Knowledge ID format');
  }

  try {
    // Use type conversion with template string to ensure the typing is correct
    const typedKnowledgeId = knowledgeId as `${string}-${string}-${string}-${string}-${string}`;
    logger.debug(`[Document Processor] 🗑️ Deleting document: ${typedKnowledgeId}`);

    await service.deleteMemory(typedKnowledgeId);
    logger.info(`[Document Processor] ✅ Successfully deleted document: ${typedKnowledgeId}`);
    sendSuccess(res, null, 204);
  } catch (error: any) {
    logger.error(`[Document Processor] ❌ Error deleting document ${knowledgeId}:`, error);
    sendError(res, 500, 'DELETE_ERROR', 'Failed to delete document', error.message);
  }
}

async function getKnowledgeByIdHandler(req: any, res: any, runtime: IAgentRuntime) {
  logger.debug(`[Document Processor] 🔍 GET request for document: ${req.params.knowledgeId}`);

  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(
      res,
      500,
      'SERVICE_NOT_FOUND',
      'KnowledgeService not found for getKnowledgeByIdHandler'
    );
  }

  // Get the ID directly from the route parameters
  const knowledgeId = req.params.knowledgeId;

  if (!knowledgeId || knowledgeId.length < 36) {
    logger.error(`[Document Processor] ❌ Invalid knowledge ID format: ${knowledgeId}`);
    return sendError(res, 400, 'INVALID_ID', 'Invalid Knowledge ID format');
  }

  try {
    logger.debug(`[Document Processor] 🔍 Retrieving document: ${knowledgeId}`);
    const agentId = req.query.agentId as UUID | undefined;

    // Use the service methods instead of calling runtime directly
    // We can't use getMemoryById directly because it's not exposed by the service
    // So we'll use getMemories with a filter
    const memories = await service.getMemories({
      tableName: 'documents',
      count: 10000,
    });

    // Use type conversion with template string to ensure the typing is correct
    const typedKnowledgeId = knowledgeId as `${string}-${string}-${string}-${string}-${string}`;

    // Find the document with the corresponding ID
    const document = memories.find((memory) => memory.id === typedKnowledgeId);

    if (!document) {
      return sendError(res, 404, 'NOT_FOUND', `Knowledge with ID ${typedKnowledgeId} not found`);
    }

    // Filter the embedding if necessary
    const cleanDocument = {
      ...document,
      embedding: undefined,
    };

    sendSuccess(res, { document: cleanDocument });
  } catch (error: any) {
    logger.error(`[Document Processor] ❌ Error retrieving document ${knowledgeId}:`, error);
    sendError(res, 500, 'RETRIEVAL_ERROR', 'Failed to retrieve document', error.message);
  }
}

// Handler for the panel itself - serves the actual HTML frontend
async function knowledgePanelHandler(req: any, res: any, runtime: IAgentRuntime) {
  const agentId = runtime.agentId; // Get from runtime context

  logger.debug(`[Document Processor] 🌐 Serving knowledge panel for agent ${agentId}`);

  try {
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    // Serve the main index.html from Vite's build output
    const frontendPath = path.join(currentDir, '../dist/index.html');

    logger.debug(`[Document Processor] 🌐 Looking for frontend at: ${frontendPath}`);

    if (fs.existsSync(frontendPath)) {
      const html = await fs.promises.readFile(frontendPath, 'utf8');
      // Inject config into existing HTML
      const injectedHtml = html.replace(
        '<head>',
        `<head>
          <script>
            window.ELIZA_CONFIG = {
              agentId: '${agentId}',
              apiBase: '/api'
            };
          </script>`
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(injectedHtml);
    } else {
      // Fallback: serve a basic HTML page that loads the JS bundle from the assets folder
      // Use manifest.json to get the correct asset filenames if it exists
      let cssFile = 'index.css';
      let jsFile = 'index.js';

      const manifestPath = path.join(currentDir, '../dist/manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestContent);

          // Look for the entry points in the manifest
          // Different Vite versions might structure the manifest differently
          for (const [key, value] of Object.entries(manifest)) {
            if (typeof value === 'object' && value !== null) {
              if (key.endsWith('.css') || (value as any).file?.endsWith('.css')) {
                cssFile = (value as any).file || key;
              }
              if (key.endsWith('.js') || (value as any).file?.endsWith('.js')) {
                jsFile = (value as any).file || key;
              }
            }
          }
        } catch (manifestError) {
          logger.error('[Document Processor] ❌ Error reading manifest:', manifestError);
          // Continue with default filenames if manifest can't be read
        }
      }

      logger.debug(`[Document Processor] 🌐 Using fallback with CSS: ${cssFile}, JS: ${jsFile}`);

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Knowledge</title>
    <script>
      window.ELIZA_CONFIG = {
        agentId: '${agentId}',
        apiBase: '/api'
      };
    </script>
    <link rel="stylesheet" href="./assets/${cssFile}">
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div id="root">
            <div class="loading">Loading Knowledge Library...</div>
        </div>
    </div>
    <script type="module" src="./assets/${jsFile}"></script>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
  } catch (error: any) {
    logger.error('[Document Processor] ❌ Error serving frontend:', error);
    sendError(res, 500, 'FRONTEND_ERROR', 'Failed to load knowledge panel', error.message);
  }
}

// Generic handler to serve static assets from the dist/assets directory
async function frontendAssetHandler(req: any, res: any, runtime: IAgentRuntime) {
  try {
    logger.debug(`[Document Processor] 🌐 Asset request: ${req.path}`);
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    const assetRequestPath = req.path; // This is the full path, e.g., /api/agents/X/plugins/knowledge/assets/file.js
    const assetsMarker = '/assets/';
    const assetsStartIndex = assetRequestPath.indexOf(assetsMarker);

    let assetName = null;
    if (assetsStartIndex !== -1) {
      assetName = assetRequestPath.substring(assetsStartIndex + assetsMarker.length);
    }

    if (!assetName || assetName.includes('..')) {
      // Basic sanitization
      return sendError(
        res,
        400,
        'BAD_REQUEST',
        `Invalid asset name: '${assetName}' from path ${assetRequestPath}`
      );
    }

    const assetPath = path.join(currentDir, '../dist/assets', assetName);
    logger.debug(`[Document Processor] 🌐 Serving asset: ${assetPath}`);

    if (fs.existsSync(assetPath)) {
      const fileStream = fs.createReadStream(assetPath);
      let contentType = 'application/octet-stream'; // Default
      if (assetPath.endsWith('.js')) {
        contentType = 'application/javascript';
      } else if (assetPath.endsWith('.css')) {
        contentType = 'text/css';
      }
      res.writeHead(200, { 'Content-Type': contentType });
      fileStream.pipe(res);
    } else {
      sendError(res, 404, 'NOT_FOUND', `Asset not found: ${req.url}`);
    }
  } catch (error: any) {
    logger.error(`[Document Processor] ❌ Error serving asset ${req.url}:`, error);
    sendError(res, 500, 'ASSET_ERROR', `Failed to load asset ${req.url}`, error.message);
  }
}

async function getKnowledgeChunksHandler(req: any, res: any, runtime: IAgentRuntime) {
  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(res, 500, 'SERVICE_NOT_FOUND', 'KnowledgeService not found');
  }

  try {
    const documentId = req.query.documentId as string | undefined;
    const documentsOnly = req.query.documentsOnly === 'true';
    const chunksDbName = (req.query.chunksDbName as string) || 'knowledge';

    // Always get documents first
    const documents = await service.getMemories({
      tableName: 'documents',
      count: 10000, // High limit to get all documents
      end: Date.now(),
    });

    // If documentsOnly mode, return only documents
    if (documentsOnly) {
      sendSuccess(res, {
        chunks: documents,
        stats: {
          documents: documents.length,
          fragments: 0,
          mode: 'documents-only',
        },
      });
      return;
    }

    // If specific document requested, get ALL its fragments
    if (documentId) {
      const allFragments = await service.getMemories({
        tableName: chunksDbName,
        count: 100000, // Very high limit to get all fragments
      });

      const documentFragments = allFragments.filter((fragment) => {
        const metadata = fragment.metadata as any;
        return metadata?.documentId === documentId;
      });

      // Return the specific document and its fragments
      const specificDocument = documents.find((d) => d.id === documentId);
      const results = specificDocument
        ? [specificDocument, ...documentFragments]
        : documentFragments;

      sendSuccess(res, {
        chunks: results,
        stats: {
          documents: specificDocument ? 1 : 0,
          fragments: documentFragments.length,
          mode: 'single-document',
          documentId,
        },
      });
      return;
    }

    // Default: return only documents
    sendSuccess(res, {
      chunks: documents,
      stats: {
        documents: documents.length,
        fragments: 0,
        mode: 'documents-only',
      },
    });
  } catch (error: any) {
    logger.error('[Document Processor] ❌ Error retrieving chunks:', error);
    sendError(res, 500, 'RETRIEVAL_ERROR', 'Failed to retrieve knowledge chunks', error.message);
  }
}

async function searchKnowledgeHandler(req: any, res: any, runtime: IAgentRuntime) {
  const service = runtime.getService<KnowledgeService>(KnowledgeService.serviceType);
  if (!service) {
    return sendError(res, 500, 'SERVICE_NOT_FOUND', 'KnowledgeService not found');
  }

  try {
    const searchText = req.query.q as string;

    // Parse threshold with NaN check
    const parsedThreshold = req.query.threshold
      ? Number.parseFloat(req.query.threshold as string)
      : NaN;
    let matchThreshold = Number.isNaN(parsedThreshold) ? 0.5 : parsedThreshold;

    // Clamp threshold between 0 and 1
    matchThreshold = Math.max(0, Math.min(1, matchThreshold));

    // Parse limit with NaN check
    const parsedLimit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : NaN;
    let limit = Number.isNaN(parsedLimit) ? 20 : parsedLimit;

    // Clamp limit between 1 and 100
    limit = Math.max(1, Math.min(100, limit));

    const agentId = (req.query.agentId as UUID) || runtime.agentId;
    const chunksDbName = (req.query.chunksDbName as string) || 'knowledge';

    if (!searchText || searchText.trim().length === 0) {
      return sendError(res, 400, 'INVALID_QUERY', 'Search query cannot be empty');
    }

    // Log if values were clamped
    if (req.query.threshold && (parsedThreshold < 0 || parsedThreshold > 1)) {
      logger.debug(
        `[Document Processor] 🔍 Threshold value ${parsedThreshold} was clamped to ${matchThreshold}`
      );
    }
    if (req.query.limit && (parsedLimit < 1 || parsedLimit > 100)) {
      logger.debug(`[Document Processor] 🔍 Limit value ${parsedLimit} was clamped to ${limit}`);
    }

    logger.debug(
      `[Document Processor] 🔍 Searching: "${searchText}" (threshold: ${matchThreshold}, limit: ${limit})`
    );

    // First get the embedding for the search text
    const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
      text: searchText,
    });

    // Use searchMemories directly for more control over the search
    const results = await runtime.searchMemories({
      tableName: chunksDbName,
      embedding,
      query: searchText,
      count: limit,
      match_threshold: matchThreshold,
      roomId: agentId,
    });

    // Enhance results with document information
    const enhancedResults = await Promise.all(
      results.map(async (fragment) => {
        let documentTitle = 'Unknown Document';
        let documentFilename = 'unknown';

        // Try to get the parent document information
        if (
          fragment.metadata &&
          typeof fragment.metadata === 'object' &&
          'documentId' in fragment.metadata
        ) {
          const documentId = fragment.metadata.documentId as UUID;
          try {
            const document = await runtime.getMemoryById(documentId);
            if (document && document.metadata) {
              documentTitle =
                (document.metadata as any).title ||
                (document.metadata as any).filename ||
                documentTitle;
              documentFilename = (document.metadata as any).filename || documentFilename;
            }
          } catch (e) {
            logger.debug(`Could not fetch document ${documentId} for fragment`);
          }
        }

        return {
          id: fragment.id,
          content: fragment.content,
          similarity: fragment.similarity || 0,
          metadata: {
            ...(fragment.metadata || {}),
            documentTitle,
            documentFilename,
          },
        };
      })
    );

    logger.info(
      `[Document Processor] 🔍 Found ${enhancedResults.length} results for: "${searchText}"`
    );

    sendSuccess(res, {
      query: searchText,
      threshold: matchThreshold,
      results: enhancedResults,
      count: enhancedResults.length,
    });
  } catch (error: any) {
    logger.error('[Document Processor] ❌ Error searching knowledge:', error);
    sendError(res, 500, 'SEARCH_ERROR', 'Failed to search knowledge', error.message);
  }
}

// Wrapper handler that applies multer middleware before calling the upload handler
async function uploadKnowledgeWithMulter(req: any, res: any, runtime: IAgentRuntime) {
  const upload = createUploadMiddleware(runtime);
  const uploadArray = upload.array(
    'files',
    parseInt(runtime.getSetting('KNOWLEDGE_MAX_FILES') || '10')
  );

  // Apply multer middleware manually
  uploadArray(req, res, (err: any) => {
    if (err) {
      logger.error('[Document Processor] ❌ File upload error:', err);
      return sendError(res, 400, 'UPLOAD_ERROR', err.message);
    }
    // If multer succeeded, call the actual handler
    uploadKnowledgeHandler(req, res, runtime);
  });
}

export const knowledgeRoutes: Route[] = [
  {
    type: 'GET',
    name: 'Knowledge',
    path: '/display',
    handler: knowledgePanelHandler,
    public: true,
  },
  {
    type: 'GET',
    path: '/assets/*',
    handler: frontendAssetHandler,
  },
  {
    type: 'POST',
    path: '/documents',
    handler: uploadKnowledgeWithMulter,
  },
  {
    type: 'GET',
    path: '/documents',
    handler: getKnowledgeDocumentsHandler,
  },
  {
    type: 'GET',
    path: '/documents/:knowledgeId',
    handler: getKnowledgeByIdHandler,
  },
  {
    type: 'DELETE',
    path: '/documents/:knowledgeId',
    handler: deleteKnowledgeDocumentHandler,
  },
  {
    type: 'GET',
    path: '/knowledges',
    handler: getKnowledgeChunksHandler,
  },
  {
    type: 'GET',
    path: '/search',
    handler: searchKnowledgeHandler,
  },
];
