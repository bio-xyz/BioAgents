import { describe, it, expect, vi, beforeEach } from "vitest";
import { TwitterMessageService } from "../MessageService";
import { MessageType } from "../IMessageService";
import type { ClientBase } from "../../base";
import { SearchMode } from "../../client";

// Mock the dependencies
vi.mock("@elizaos/core", () => ({
  createUniqueUuid: vi.fn((runtime, id) => `uuid-${id}`),
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("TwitterMessageService", () => {
  let service: TwitterMessageService;
  let mockClient: any;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      runtime: {
        agentId: "agent-123",
      },
      profile: {
        id: "user-123",
        username: "testuser",
      },
      fetchSearchTweets: vi.fn(),
      twitterClient: {
        sendDirectMessage: vi.fn(),
        sendTweet: vi.fn(),
        deleteTweet: vi.fn(),
        getTweet: vi.fn(),
      },
    };

    service = new TwitterMessageService(mockClient as ClientBase);
  });

  describe("getMessages", () => {
    it("should fetch messages based on mentions", async () => {
      const mockTweets = [
        {
          id: "tweet-1",
          userId: "user-456",
          username: "otheruser",
          text: "@testuser Hello!",
          conversationId: "conv-1",
          timestamp: 1234567890,
          inReplyToStatusId: null,
          permanentUrl: "https://twitter.com/otheruser/status/tweet-1",
        },
        {
          id: "tweet-2",
          userId: "user-789",
          username: "anotheruser",
          text: "@testuser How are you?",
          conversationId: "conv-2",
          timestamp: 1234567891,
          inReplyToStatusId: "tweet-0",
          permanentUrl: "https://twitter.com/anotheruser/status/tweet-2",
        },
      ];

      mockClient.fetchSearchTweets.mockResolvedValue({
        tweets: mockTweets,
      });

      const options = {
        agentId: "agent-123" as any,
        limit: 10,
      };

      const messages = await service.getMessages(options);

      expect(mockClient.fetchSearchTweets).toHaveBeenCalledWith(
        "@testuser",
        10,
        SearchMode.Latest,
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        id: "tweet-1",
        agentId: "agent-123",
        roomId: "uuid-conv-1",
        userId: "user-456",
        username: "otheruser",
        text: "@testuser Hello!",
        type: MessageType.MENTION,
        timestamp: 1234567890000,
        inReplyTo: null,
        metadata: {
          tweetId: "tweet-1",
          permanentUrl: "https://twitter.com/otheruser/status/tweet-1",
        },
      });

      expect(messages[1].type).toBe(MessageType.REPLY);
    });

    it("should filter by roomId when specified", async () => {
      const mockTweets = [
        {
          id: "tweet-1",
          conversationId: "conv-1",
          userId: "user-456",
          username: "otheruser",
          text: "Hello",
          timestamp: 1234567890,
        },
        {
          id: "tweet-2",
          conversationId: "conv-2",
          userId: "user-789",
          username: "anotheruser",
          text: "Hi",
          timestamp: 1234567891,
        },
      ];

      mockClient.fetchSearchTweets.mockResolvedValue({
        tweets: mockTweets,
      });

      const options = {
        agentId: "agent-123" as any,
        roomId: "uuid-conv-1" as any,
      };

      const messages = await service.getMessages(options);

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("tweet-1");
    });

    it("should handle errors gracefully", async () => {
      mockClient.fetchSearchTweets.mockRejectedValue(new Error("API Error"));

      const options = {
        agentId: "agent-123" as any,
      };

      const messages = await service.getMessages(options);

      expect(messages).toEqual([]);
    });
  });

  describe("sendMessage", () => {
    it("should send a direct message", async () => {
      const mockResult = {
        id: "dm-123",
        text: "Hello DM",
      };

      mockClient.twitterClient.sendDirectMessage.mockResolvedValue(mockResult);

      const options = {
        agentId: "agent-123" as any,
        roomId: "room-123" as any,
        text: "Hello DM",
        type: MessageType.DIRECT_MESSAGE,
      };

      const message = await service.sendMessage(options);

      expect(mockClient.twitterClient.sendDirectMessage).toHaveBeenCalledWith(
        "room-123",
        "Hello DM",
      );

      expect(message).toEqual({
        id: "dm-123",
        agentId: "agent-123",
        roomId: "room-123",
        userId: "user-123",
        username: "testuser",
        text: "Hello DM",
        type: MessageType.DIRECT_MESSAGE,
        timestamp: expect.any(Number),
        inReplyTo: undefined,
        metadata: {
          result: mockResult,
        },
      });
    });

    it("should send a tweet", async () => {
      const mockResult = {
        rest_id: "tweet-123",
      };

      mockClient.twitterClient.sendTweet.mockResolvedValue(mockResult);

      const options = {
        agentId: "agent-123" as any,
        roomId: "room-123" as any,
        text: "Hello Tweet",
        type: MessageType.POST,
        replyToId: "reply-to-123",
      };

      const message = await service.sendMessage(options);

      expect(mockClient.twitterClient.sendTweet).toHaveBeenCalledWith(
        "Hello Tweet",
        "reply-to-123",
      );

      expect(message.id).toBe("tweet-123");
      expect(message.type).toBe(MessageType.POST);
    });
  });

  describe("deleteMessage", () => {
    it("should delete a message", async () => {
      await service.deleteMessage("tweet-123", "agent-123" as any);

      expect(mockClient.twitterClient.deleteTweet).toHaveBeenCalledWith(
        "tweet-123",
      );
    });

    it("should throw error on failure", async () => {
      mockClient.twitterClient.deleteTweet.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(
        service.deleteMessage("tweet-123", "agent-123" as any),
      ).rejects.toThrow("Delete failed");
    });
  });

  describe("getMessage", () => {
    it("should fetch a single message", async () => {
      const mockTweet = {
        id: "tweet-123",
        userId: "user-456",
        username: "someuser",
        text: "Hello World",
        conversationId: "conv-123",
        timestamp: 1234567890,
        inReplyToStatusId: "tweet-100",
        permanentUrl: "https://twitter.com/someuser/status/tweet-123",
      };

      mockClient.twitterClient.getTweet.mockResolvedValue(mockTweet);

      const message = await service.getMessage("tweet-123", "agent-123" as any);

      expect(message).toEqual({
        id: "tweet-123",
        agentId: "agent-123",
        roomId: "uuid-conv-123",
        userId: "user-456",
        username: "someuser",
        text: "Hello World",
        type: MessageType.REPLY,
        timestamp: 1234567890000,
        inReplyTo: "tweet-100",
        metadata: {
          tweetId: "tweet-123",
          permanentUrl: "https://twitter.com/someuser/status/tweet-123",
        },
      });
    });

    it("should return null if tweet not found", async () => {
      mockClient.twitterClient.getTweet.mockResolvedValue(null);

      const message = await service.getMessage("tweet-123", "agent-123" as any);

      expect(message).toBeNull();
    });
  });

  describe("markAsRead", () => {
    it("should log that marking as read is not implemented", async () => {
      const { logger } = await import("@elizaos/core");
      const logSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});

      await service.markAsRead(["tweet-1", "tweet-2"], "agent-123" as any);

      expect(logSpy).toHaveBeenCalledWith(
        "Marking messages as read is not implemented for Twitter",
      );

      logSpy.mockRestore();
    });
  });
});
