import { describe, expect, test } from "bun:test";
import type { ConversationStateValues } from "../../types/core";
import { NORMAL_CHAT_ARTIFACTS_KEY, withNormalChatArtifacts } from "../artifacts";

describe("withNormalChatArtifacts", () => {
  test("stores normal chat artifacts under a reload-compatible message map", () => {
    const values = { objective: "segment cells" } as ConversationStateValues;

    const nextValues = withNormalChatArtifacts(values, "msg-1", [
      {
        id: "artifact-1",
        name: "Annotated image",
        path: "artifacts/msg-1/annotated.png",
        type: "image",
      },
    ]);

    expect(nextValues[NORMAL_CHAT_ARTIFACTS_KEY]?.["msg-1"]).toEqual([
      {
        id: "artifact-1",
        name: "Annotated image",
        path: "artifacts/msg-1/annotated.png",
        type: "image",
      },
    ]);
  });

  test("merges artifacts without duplicating an existing message entry", () => {
    const values = {
      normalChatArtifactsByMessageId: {
        "msg-1": [
          {
            id: "artifact-1",
            name: "Annotated image",
            path: "artifacts/msg-1/annotated.png",
            type: "image",
          },
        ],
      },
      objective: "segment cells",
    } as ConversationStateValues;

    const nextValues = withNormalChatArtifacts(values, "msg-1", [
      {
        id: "artifact-1",
        name: "Annotated image duplicate",
        path: "artifacts/msg-1/annotated.png",
        type: "image",
      },
      {
        id: "artifact-2",
        name: "Mask metadata",
        path: "artifacts/msg-1/masks.json",
        type: "file",
      },
    ]);

    expect(nextValues.normalChatArtifactsByMessageId?.["msg-1"]).toEqual([
      {
        id: "artifact-1",
        name: "Annotated image",
        path: "artifacts/msg-1/annotated.png",
        type: "image",
      },
      {
        id: "artifact-2",
        name: "Mask metadata",
        path: "artifacts/msg-1/masks.json",
        type: "file",
      },
    ]);
  });
});
