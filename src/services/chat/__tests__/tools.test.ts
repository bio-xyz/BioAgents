import { describe, expect, test } from "bun:test";
import { normalizeMessageFileMetadata } from "../fileMetadata";

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
