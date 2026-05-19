import { getConversationBasePath, getStorageProvider } from "../../storage";
import type {
  ChatToolId,
  ConversationState,
  DataArtifact,
  SegmentAnythingPoint,
  SegmentAnythingToolInput,
} from "../../types/core";
import { fetchWithRetry } from "../../utils/fetchWithRetry";
import logger from "../../utils/logger";
import { getFileStatus } from "../files/status";

const SEGMENT_ANYTHING_TOOL_ID: ChatToolId = "segment-anything";
const IMAGE_EXTENSIONS = new Set(["bmp", "gif", "jpeg", "jpg", "png", "tif", "tiff", "webp"]);
const MAX_SEGMENT_ANYTHING_PROMPT_LENGTH = 500;
const MAX_SEGMENT_ANYTHING_IMAGE_BYTES = 50 * 1024 * 1024;
const SEGMENT_ANYTHING_RETRY_STATUS_CODES = [429, 500, 502, 504];

type UploadedDataset = NonNullable<ConversationState["values"]["uploadedDatasets"]>[number];

type SegmentAnythingRequest = {
  confidence?: number;
  image_base64: string;
  point?: SegmentAnythingPoint;
  prompt: string;
};

type SegmentAnythingResponse = {
  annotated_image: {
    content: string;
    mime_type?: string;
  };
  confidence: number;
  count: number;
  dimensions: {
    height: number;
    width: number;
  };
  objects?: unknown[];
  prompt: string;
  summary: string;
};

type StorageForSegmentAnything = {
  download(path: string): Promise<Buffer>;
  fetchFileByRelativePath?(
    userId: string,
    conversationStateId: string,
    relativePath: string
  ): Promise<Buffer>;
  upload(path: string, buffer: Buffer, mimeType: string): Promise<string>;
};

type FileStatusLookup = typeof getFileStatus;
type SegmentAnythingClient = (request: SegmentAnythingRequest) => Promise<SegmentAnythingResponse>;

export class SegmentAnythingToolError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SegmentAnythingToolError";
    this.statusCode = statusCode;
  }
}

export function parseChatToolId(value: unknown): ChatToolId | undefined {
  return value === SEGMENT_ANYTHING_TOOL_ID ? SEGMENT_ANYTHING_TOOL_ID : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePoint(value: unknown): SegmentAnythingPoint | undefined {
  const point = asRecord(value);
  if (!point) return undefined;

  const x = asNumber(point.x);
  const y = asNumber(point.y);
  if (x === undefined || y === undefined) return undefined;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new SegmentAnythingToolError("Segment point must be normalized between 0 and 1.");
  }
  return { x, y };
}

function normalizeToolInput(value: unknown): SegmentAnythingToolInput {
  const input = asRecord(value) || {};
  const confidence = asNumber(input.confidence);
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    throw new SegmentAnythingToolError("Segment confidence must be between 0 and 1.");
  }

  return {
    confidence,
    imageFileId: asString(input.imageFileId),
    imageFilename: asString(input.imageFilename),
    point: normalizePoint(input.point),
  };
}

function extension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function isImageUpload(filename: string, contentType?: string): boolean {
  if (contentType) return contentType.startsWith("image/");
  return IMAGE_EXTENSIONS.has(extension(filename));
}

function imageExtensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function findDataset(
  datasets: UploadedDataset[],
  input: SegmentAnythingToolInput
): UploadedDataset | undefined {
  if (input.imageFileId) {
    return datasets.find((dataset) => dataset.id === input.imageFileId);
  }
  if (input.imageFilename) {
    return datasets.find((dataset) => dataset.filename === input.imageFilename);
  }
  return datasets.find((dataset) => isImageUpload(dataset.filename));
}

async function callBioLiteratureSegmentAnything(
  request: SegmentAnythingRequest
): Promise<SegmentAnythingResponse> {
  const baseUrl = process.env.BIO_LIT_AGENT_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.BIO_LIT_AGENT_API_KEY || "";

  if (!baseUrl || !apiKey) {
    throw new SegmentAnythingToolError("BioLiterature API URL or API key not configured", 503);
  }

  const { response } = await fetchWithRetry(
    `${baseUrl}/tools/segment-anything`,
    {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
    },
    {
      onRetry: (attempt, error) =>
        logger.warn({ attempt, error: error.message }, "segment_anything_retry"),
      retryStatusCodes: SEGMENT_ANYTHING_RETRY_STATUS_CODES,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new SegmentAnythingToolError(
      `BioLiterature Segment Anything error: ${response.status} - ${errorText}`,
      response.status >= 500 ? 502 : response.status
    );
  }

  return (await response.json()) as SegmentAnythingResponse;
}

function artifactDescription(count: number, confidence: number, filename: string): string {
  const noun = count === 1 ? "object" : "objects";
  return `Segmented ${count} ${noun} at confidence ${confidence} from ${filename}.`;
}

export async function runSegmentAnythingChatTool(
  params: {
    conversationState: ConversationState;
    message: string;
    messageId: string;
    toolInput?: unknown;
    userId: string;
  },
  deps: {
    getFileStatus?: FileStatusLookup;
    segmentClient?: SegmentAnythingClient;
    storageProvider?: StorageForSegmentAnything | null;
  } = {}
): Promise<{ artifacts: DataArtifact[]; text: string }> {
  const { conversationState, message, messageId, userId } = params;
  const input = normalizeToolInput(params.toolInput);
  if (message.length > MAX_SEGMENT_ANYTHING_PROMPT_LENGTH) {
    throw new SegmentAnythingToolError(
      "Segment Anything prompt must be 500 characters or fewer.",
      400
    );
  }

  const datasets = conversationState.values.uploadedDatasets || [];
  const dataset = findDataset(datasets, input);

  if (!dataset) {
    throw new SegmentAnythingToolError("Segment Anything requires an image upload.");
  }

  const fileStatus = input.imageFileId
    ? await (deps.getFileStatus || getFileStatus)(input.imageFileId)
    : null;
  const contentType = fileStatus?.contentType;
  if (!isImageUpload(dataset.filename, contentType)) {
    throw new SegmentAnythingToolError("Segment Anything requires an image upload.");
  }
  const imageSize = fileStatus?.size ?? dataset.size;
  if (typeof imageSize === "number" && imageSize > MAX_SEGMENT_ANYTHING_IMAGE_BYTES) {
    throw new SegmentAnythingToolError("Segment Anything image must be 50 MB or smaller.", 400);
  }

  const storageProvider = deps.storageProvider ?? getStorageProvider();
  if (!storageProvider) {
    throw new SegmentAnythingToolError("Storage provider not configured", 503);
  }
  if (!conversationState.id) {
    throw new SegmentAnythingToolError("Conversation state is required for Segment Anything", 500);
  }

  const rawImage = fileStatus?.s3Key
    ? await storageProvider.download(fileStatus.s3Key)
    : await storageProvider.fetchFileByRelativePath?.(
        userId,
        conversationState.id,
        dataset.path || `uploads/${dataset.filename}`
      );
  if (!rawImage) {
    throw new SegmentAnythingToolError("Unable to read the uploaded image", 500);
  }

  const segmentClient = deps.segmentClient || callBioLiteratureSegmentAnything;
  const segmentResponse = await segmentClient({
    confidence: input.confidence,
    image_base64: rawImage.toString("base64"),
    point: input.point,
    prompt: message,
  });

  const artifactMimeType = segmentResponse.annotated_image.mime_type || "image/png";
  const artifactExtension = imageExtensionForMimeType(artifactMimeType);
  const artifactPath = `artifacts/${messageId}/segment-anything-annotated.${artifactExtension}`;
  const fullArtifactPath = `${getConversationBasePath(userId, conversationState.id)}/${artifactPath}`;
  await storageProvider.upload(
    fullArtifactPath,
    Buffer.from(segmentResponse.annotated_image.content, "base64"),
    artifactMimeType
  );

  const artifact: DataArtifact = {
    description: artifactDescription(
      segmentResponse.count,
      segmentResponse.confidence,
      dataset.filename
    ),
    id: `segment-anything-${messageId}`,
    metadata: {
      confidence: segmentResponse.confidence,
      count: segmentResponse.count,
      dimensions: segmentResponse.dimensions,
      objects: segmentResponse.objects || [],
      prompt: segmentResponse.prompt,
    },
    mimeType: artifactMimeType,
    name: `Segment Anything result for ${dataset.filename}`,
    path: artifactPath,
    type: "image",
  };

  const dimensions = `${segmentResponse.dimensions.width}x${segmentResponse.dimensions.height}`;
  return {
    artifacts: [artifact],
    text: `${segmentResponse.summary}\n\nAnnotated image: ${artifact.name}. Image dimensions: ${dimensions}.`,
  };
}
