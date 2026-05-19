import { describe, expect, test } from "bun:test";
import { resolveDownloadableFileMetadata } from "../download-url";

describe("resolveDownloadableFileMetadata", () => {
  test("prefers the temporary status record when it is still available", () => {
    const result = resolveDownloadableFileMetadata({
      persistedFile: {
        fileId: "file-1",
        fileKey: "persisted/key.png",
        name: "persisted.png",
        size: 456,
        type: "image/png",
      },
      status: {
        contentType: "image/png",
        fileId: "file-1",
        filename: "status.png",
        s3Key: "status/key.png",
        size: 123,
      },
    });

    expect(result).toEqual({
      contentType: "image/png",
      fileId: "file-1",
      fileKey: "status/key.png",
      filename: "status.png",
      size: 123,
    });
  });

  test("falls back to persisted message file metadata after status TTL expiry", () => {
    const result = resolveDownloadableFileMetadata({
      persistedFile: {
        fileId: "file-1",
        fileKey: "persisted/key.webp",
        name: "cells.webp",
        size: 456,
        type: "image/webp",
      },
      status: null,
    });

    expect(result).toEqual({
      contentType: "image/webp",
      fileId: "file-1",
      fileKey: "persisted/key.webp",
      filename: "cells.webp",
      size: 456,
    });
  });
});
