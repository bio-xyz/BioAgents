import { describe, expect, test } from "bun:test";
import type { ConversationState } from "../../../types/core";
import { runSegmentAnythingChatTool, SegmentAnythingToolError } from "../chat-tool";

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
});
