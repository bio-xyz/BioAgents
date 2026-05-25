import { afterEach, describe, expect, jest, mock, test } from "bun:test";

const notifyMessageUpdated = jest.fn(async () => undefined);
const notifyJobCompleted = jest.fn(async () => undefined);

mock.module("../../services/queue/notify", () => ({
  notifyJobCompleted,
  notifyMessageUpdated,
}));

import logger from "../../utils/logger";
import { notifyChatReplyCompleted } from "../chat-notifications";

afterEach(() => {
  jest.clearAllMocks();
});

describe("notifyChatReplyCompleted", () => {
  test("publishes message update and completion notifications using the message id as job id", async () => {
    await notifyChatReplyCompleted({
      conversationId: "conversation-1",
      messageId: "message-1",
      proteinStructures: [{ bcifUrl: "https://example.test/a.bcif", entryId: "AF-P04637-F1" }],
    });

    expect(notifyJobCompleted).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      "message-1",
      undefined,
      {
        proteinStructures: [{ bcifUrl: "https://example.test/a.bcif", entryId: "AF-P04637-F1" }],
      }
    );
    expect(notifyMessageUpdated).toHaveBeenCalledWith("message-1", "conversation-1", "message-1");
  });

  test("still publishes completion when the message-updated notification fails", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    notifyMessageUpdated.mockRejectedValueOnce(new Error("redis unavailable"));

    try {
      await expect(
        notifyChatReplyCompleted({
          conversationId: "conversation-1",
          messageId: "message-1",
        })
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "message-1" }),
        "chat_sse_message_updated_notify_failed"
      );
      expect(notifyJobCompleted).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
