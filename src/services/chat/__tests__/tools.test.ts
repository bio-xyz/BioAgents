import { describe, expect, test } from "bun:test";
import { normalizeMessageFileMetadata, parseUploadedFileReferences } from "../fileMetadata";

describe("normalizeMessageFileMetadata", () => {
  test("keeps file ids from presigned upload references", () => {
    expect(
      normalizeMessageFileMetadata({
        fileReferences: [
          {
            contentType: "image/png",
            fileId: "file-1",
            fileKey: "user/u/conversation/s/uploads/cells.png",
            filename: "cells.png",
            size: 1234,
            uploadedAt: 1233,
          },
        ],
        files: [],
      })
    ).toEqual([
      {
        fileId: "file-1",
        fileKey: "user/u/conversation/s/uploads/cells.png",
        name: "cells.png",
        size: 1234,
        type: "image/png",
      },
    ]);
  });
});

describe("parseUploadedFileReferences", () => {
  test("returns null for malformed JSON instead of silently dropping file context", () => {
    expect(parseUploadedFileReferences("{bad json")).toBeNull();
  });

  test("returns null for invalid uploaded file reference entries", () => {
    expect(
      parseUploadedFileReferences(JSON.stringify([{ fileId: "file-1", filename: "cells.png" }]))
    ).toBeNull();
  });
});
