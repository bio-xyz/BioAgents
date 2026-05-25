import { describe, expect, test } from "bun:test";
import type { ConversationState } from "../../../types/core";
import {
  callBioLiteratureSegmentAnything,
  runSegmentAnythingChatTool,
  SegmentAnythingToolError,
} from "../chat-tool";

function conversationState(): ConversationState {
  return {
    id: "state-1",
    values: {
      objective: "segment cells",
      uploadedDatasets: [
        {
          description: "Microscopy image",
          filename: "cells.png",
          id: "file-1",
          path: "uploads/cells.png",
          size: 128,
        },
      ],
    },
  };
}

function segmentResponse(mimeType = "image/png") {
  return {
    annotated_image: {
      content: Buffer.from("annotated-image").toString("base64"),
      mime_type: mimeType,
    },
    confidence: 0.5,
    count: 1,
    dimensions: { height: 10, width: 20 },
    objects: [],
    prompt: "segment the cells",
    summary: "Segmented 1 object.",
  };
}

describe("runSegmentAnythingChatTool", () => {
  test("downloads the uploaded image, calls BioLiterature SAM, and stores an image artifact", async () => {
    const downloads: string[] = [];
    const uploads: Array<{ path: string; buffer: Buffer; mimeType: string }> = [];

    const result = await runSegmentAnythingChatTool(
      {
        conversationState: conversationState(),
        message: "segment the cells",
        messageId: "message-1",
        toolInput: {
          confidence: 0.42,
          imageFileId: "file-1",
          point: { x: 0.25, y: 0.75 },
        },
        userId: "user-1",
      },
      {
        getFileStatus: async () =>
          ({
            contentType: "image/png",
            s3Key: "user/user-1/conversation/state-1/uploads/cells.png",
            userId: "user-1",
          }) as never,
        segmentClient: async (request) => {
          expect(request).toEqual({
            confidence: 0.42,
            image_base64: Buffer.from("raw-image").toString("base64"),
            point: { x: 0.25, y: 0.75 },
            prompt: "segment the cells",
          });
          return {
            annotated_image: {
              content: Buffer.from("annotated-image").toString("base64"),
              mime_type: "image/png",
            },
            confidence: 0.42,
            count: 2,
            dimensions: { height: 480, width: 640 },
            objects: [{ bbox: [1, 2, 3, 4], id: "1", score: 0.9 }],
            prompt: "segment the cells",
            summary: "Segmented 2 objects matching 'segment the cells'.",
          };
        },
        storageProvider: {
          download: async (path: string) => {
            downloads.push(path);
            return Buffer.from("raw-image");
          },
          upload: async (path: string, buffer: Buffer, mimeType: string) => {
            uploads.push({ buffer, mimeType, path });
            return path;
          },
        },
      }
    );

    expect(downloads).toEqual(["user/user-1/conversation/state-1/uploads/cells.png"]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.path).toBe(
      "user/user-1/conversation/state-1/artifacts/message-1/segment-anything-annotated.png"
    );
    expect(uploads[0]?.buffer.toString()).toBe("annotated-image");
    expect(uploads[0]?.mimeType).toBe("image/png");
    expect(result.text).toContain("Segmented 2 objects");
    expect(result.artifacts).toEqual([
      {
        description: "Segmented 2 objects at confidence 0.42 from cells.png.",
        id: "segment-anything-message-1",
        metadata: {
          confidence: 0.42,
          count: 2,
          dimensions: { height: 480, width: 640 },
          objects: [{ bbox: [1, 2, 3, 4], id: "1", score: 0.9 }],
          prompt: "segment the cells",
        },
        mimeType: "image/png",
        name: "Segment Anything result for cells.png",
        path: "artifacts/message-1/segment-anything-annotated.png",
        type: "image",
      },
    ]);
  });

  test("rejects a non-image upload before calling BioLiterature", async () => {
    let called = false;

    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the file",
          messageId: "message-1",
          toolInput: { imageFileId: "file-1" },
          userId: "user-1",
        },
        {
          getFileStatus: async () =>
            ({
              contentType: "application/pdf",
              s3Key: "user/user-1/conversation/state-1/uploads/cells.pdf",
              userId: "user-1",
            }) as never,
          segmentClient: async () => {
            called = true;
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("pdf"),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything requires an image upload.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);

    expect(called).toBe(false);
  });

  test("rejects SVG uploads even when their MIME type starts with image", async () => {
    let called = false;

    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: {
            id: "state-1",
            values: {
              objective: "segment cells",
              uploadedDatasets: [
                {
                  description: "Vector image",
                  filename: "cells.svg",
                  id: "file-1",
                  path: "uploads/cells.svg",
                },
              ],
            },
          },
          message: "segment the file",
          messageId: "message-1",
          toolInput: { imageFileId: "file-1" },
          userId: "user-1",
        },
        {
          getFileStatus: async () =>
            ({
              contentType: "image/svg+xml",
              s3Key: "user/user-1/conversation/state-1/uploads/cells.svg",
              size: 128,
              userId: "user-1",
            }) as never,
          segmentClient: async () => {
            called = true;
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("<svg />"),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything requires an image upload.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);

    expect(called).toBe(false);
  });

  test("requires an explicit image when multiple image uploads are available", async () => {
    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: {
            id: "state-1",
            values: {
              objective: "segment cells",
              uploadedDatasets: [
                {
                  description: "First image",
                  filename: "cells.png",
                  id: "file-1",
                  path: "uploads/cells.png",
                },
                {
                  description: "Second image",
                  filename: "tissue.webp",
                  id: "file-2",
                  path: "uploads/tissue.webp",
                },
              ],
            },
          },
          message: "segment the cells",
          messageId: "message-1",
          userId: "user-1",
        },
        {
          segmentClient: async () => {
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("raw-image"),
            fetchFileByRelativePath: async () => Buffer.from("raw-image"),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Specify which image to segment.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);
  });

  test("rejects prompts over 500 characters before downloading the object", async () => {
    let downloaded = false;
    let called = false;

    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "x".repeat(501),
          messageId: "message-1",
          toolInput: { imageFileId: "file-1" },
          userId: "user-1",
        },
        {
          getFileStatus: async () =>
            ({
              contentType: "image/png",
              s3Key: "user/user-1/conversation/state-1/uploads/cells.png",
              size: 128,
              userId: "user-1",
            }) as never,
          segmentClient: async () => {
            called = true;
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => {
              downloaded = true;
              return Buffer.from("raw-image");
            },
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything prompt must be 500 characters or fewer.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);

    expect(downloaded).toBe(false);
    expect(called).toBe(false);
  });

  test("rejects images over 50 MB before downloading the object", async () => {
    let downloaded = false;
    let called = false;

    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the cells",
          messageId: "message-1",
          toolInput: { imageFileId: "file-1" },
          userId: "user-1",
        },
        {
          getFileStatus: async () =>
            ({
              contentType: "image/png",
              s3Key: "user/user-1/conversation/state-1/uploads/cells.png",
              size: 50 * 1024 * 1024 + 1,
              userId: "user-1",
            }) as never,
          segmentClient: async () => {
            called = true;
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => {
              downloaded = true;
              return Buffer.from("raw-image");
            },
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything image must be 50 MB or smaller.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);

    expect(downloaded).toBe(false);
    expect(called).toBe(false);
  });

  test("rejects normalized points outside the image bounds", async () => {
    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the cells",
          messageId: "message-1",
          toolInput: { imageFileId: "file-1", point: { x: 1.1, y: 0.5 } },
          userId: "user-1",
        },
        {
          segmentClient: async () => {
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("raw-image"),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment point must be normalized between 0 and 1.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);
  });

  test("rejects downloaded images over 50 MB when no size metadata exists", async () => {
    let called = false;

    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the cells",
          messageId: "message-1",
          toolInput: { imageFilename: "cells.png" },
          userId: "user-1",
        },
        {
          segmentClient: async () => {
            called = true;
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("unused"),
            fetchFileByRelativePath: async () => Buffer.alloc(50 * 1024 * 1024 + 1),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything image must be 50 MB or smaller.",
      statusCode: 400,
    } satisfies Partial<SegmentAnythingToolError>);

    expect(called).toBe(false);
  });

  test("fails explicitly when filename fallback storage reads are unavailable", async () => {
    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the cells",
          messageId: "message-1",
          toolInput: { imageFilename: "cells.png" },
          userId: "user-1",
        },
        {
          segmentClient: async () => {
            throw new Error("should not call BioLiterature");
          },
          storageProvider: {
            download: async () => Buffer.from("unused"),
            upload: async () => "unused",
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Unable to read the uploaded image",
      statusCode: 500,
    } satisfies Partial<SegmentAnythingToolError>);
  });

  test("uses the annotated image MIME type when choosing the artifact extension", async () => {
    const uploads: Array<{ path: string; mimeType: string }> = [];

    const result = await runSegmentAnythingChatTool(
      {
        conversationState: conversationState(),
        message: "segment the cells",
        messageId: "message-1",
        toolInput: { imageFileId: "file-1" },
        userId: "user-1",
      },
      {
        getFileStatus: async () =>
          ({
            contentType: "image/png",
            s3Key: "user/user-1/conversation/state-1/uploads/cells.png",
            size: 128,
            userId: "user-1",
          }) as never,
        segmentClient: async () => segmentResponse("image/webp"),
        storageProvider: {
          download: async () => Buffer.from("raw-image"),
          upload: async (path: string, _buffer: Buffer, mimeType: string) => {
            uploads.push({ mimeType, path });
            return path;
          },
        },
      }
    );

    expect(uploads[0]).toEqual({
      mimeType: "image/webp",
      path: "user/user-1/conversation/state-1/artifacts/message-1/segment-anything-annotated.webp",
    });
    expect(result.artifacts[0]?.mimeType).toBe("image/webp");
    expect(result.artifacts[0]?.path).toBe("artifacts/message-1/segment-anything-annotated.webp");
  });

  test("rejects unsupported annotated image MIME types instead of writing a wrong extension", async () => {
    await expect(
      runSegmentAnythingChatTool(
        {
          conversationState: conversationState(),
          message: "segment the cells",
          messageId: "message-1",
          toolInput: { imageFileId: "file-1" },
          userId: "user-1",
        },
        {
          getFileStatus: async () =>
            ({
              contentType: "image/png",
              s3Key: "user/user-1/conversation/state-1/uploads/cells.png",
              size: 128,
              userId: "user-1",
            }) as never,
          segmentClient: async () => segmentResponse("image/tiff"),
          storageProvider: {
            download: async () => Buffer.from("raw-image"),
            upload: async () => {
              throw new Error("should not upload unsupported output");
            },
          },
        }
      )
    ).rejects.toMatchObject({
      message: "Segment Anything returned an unsupported image type",
      statusCode: 502,
    } satisfies Partial<SegmentAnythingToolError>);
  });
});

describe("callBioLiteratureSegmentAnything", () => {
  test("reports missing BioLiterature configuration as a service error", async () => {
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    delete process.env.BIO_LIT_AGENT_API_URL;
    delete process.env.BIO_LIT_AGENT_API_KEY;

    try {
      await expect(
        callBioLiteratureSegmentAnything({
          image_base64: "aW1hZ2U=",
          prompt: "segment the cells",
        })
      ).rejects.toMatchObject({
        message: "BioLiterature API URL or API key not configured",
        statusCode: 503,
      } satisfies Partial<SegmentAnythingToolError>);
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.BIO_LIT_AGENT_API_URL;
      } else {
        process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      }
      if (originalApiKey === undefined) {
        delete process.env.BIO_LIT_AGENT_API_KEY;
      } else {
        process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
      }
    }
  });

  test("does not leak upstream response bodies in user-facing errors", async () => {
    const originalBaseUrl = process.env.BIO_LIT_AGENT_API_URL;
    const originalApiKey = process.env.BIO_LIT_AGENT_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.BIO_LIT_AGENT_API_URL = "https://literature.example.test";
    process.env.BIO_LIT_AGENT_API_KEY = "secret";
    globalThis.fetch = (async () =>
      new Response("stacktrace with internal-host.local", {
        status: 501,
      })) as unknown as typeof fetch;

    try {
      await expect(
        callBioLiteratureSegmentAnything({
          image_base64: "aW1hZ2U=",
          prompt: "segment the cells",
        })
      ).rejects.toMatchObject({
        message: "BioLiterature Segment Anything error: 501",
        statusCode: 502,
      } satisfies Partial<SegmentAnythingToolError>);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBaseUrl === undefined) {
        delete process.env.BIO_LIT_AGENT_API_URL;
      } else {
        process.env.BIO_LIT_AGENT_API_URL = originalBaseUrl;
      }
      if (originalApiKey === undefined) {
        delete process.env.BIO_LIT_AGENT_API_KEY;
      } else {
        process.env.BIO_LIT_AGENT_API_KEY = originalApiKey;
      }
    }
  });
});
