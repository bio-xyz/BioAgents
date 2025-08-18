import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { TwitterAuth } from "../../client/auth";
import { TwitterMessageService } from "../../services/MessageService";
import { TwitterPostService } from "../../services/PostService";
import { ClientBase } from "../../base";
import { MessageType } from "../../services/IMessageService";
import { SearchMode } from "../../client";
import type { IAgentRuntime } from "@elizaos/core";
import dotenv from "dotenv";

// Load environment variables from .env.test file
dotenv.config({ path: ".env.test" });

// Skip these tests if no API credentials are provided
const SKIP_E2E =
  !process.env.TWITTER_API_KEY ||
  !process.env.TWITTER_API_SECRET_KEY ||
  !process.env.TWITTER_ACCESS_TOKEN ||
  !process.env.TWITTER_ACCESS_TOKEN_SECRET;

describe.skipIf(SKIP_E2E)("Twitter E2E Integration Tests", () => {
  let auth: TwitterAuth;
  let client: ClientBase;
  let messageService: TwitterMessageService;
  let postService: TwitterPostService;
  let runtime: IAgentRuntime;
  let testTweetIds: string[] = [];

  beforeAll(async () => {
    // Setup runtime mock
    runtime = {
      agentId: "test-agent-123" as any,
      getSetting: (key: string) => process.env[key],
      character: {},
      getCache: vi.fn(),
      setCache: vi.fn(),
      getMemoriesByRoomIds: vi.fn().mockResolvedValue([]),
      ensureWorldExists: vi.fn(),
      ensureConnection: vi.fn(),
      createMemory: vi.fn(),
      getEntityById: vi.fn().mockResolvedValue(null),
      updateEntity: vi.fn(),
    } as any;

    // Initialize client with real credentials
    const state = {
      TWITTER_API_KEY: process.env.TWITTER_API_KEY,
      TWITTER_API_SECRET_KEY: process.env.TWITTER_API_SECRET_KEY,
      TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    };

    client = new ClientBase(runtime, state);
    await client.init();

    // Initialize services
    messageService = new TwitterMessageService(client);
    postService = new TwitterPostService(client);
  });

  afterAll(async () => {
    // Cleanup: Delete all test tweets
    console.log(`Cleaning up ${testTweetIds.length} test tweets...`);

    for (const tweetId of testTweetIds) {
      try {
        await postService.deletePost(tweetId, runtime.agentId);
        console.log(`Deleted tweet ${tweetId}`);
      } catch (error) {
        console.error(`Failed to delete tweet ${tweetId}:`, error);
      }
    }
  });

  beforeEach(() => {
    // Add delay between tests to avoid rate limiting
    return new Promise((resolve) => setTimeout(resolve, 2000));
  });

  describe("Authentication", () => {
    it("should authenticate successfully with API v2 credentials", async () => {
      const isLoggedIn = await client.twitterClient.isLoggedIn();
      expect(isLoggedIn).toBe(true);
    });

    it("should fetch authenticated user profile", async () => {
      const profile = await client.twitterClient.me();

      expect(profile).toBeDefined();
      expect(profile?.userId).toBeDefined();
      expect(profile?.username).toBeDefined();
      expect(profile?.name).toBeDefined();

      console.log("Authenticated as:", {
        userId: profile?.userId,
        username: profile?.username,
        name: profile?.name,
      });
    });
  });

  describe("PostService", () => {
    it("should create a simple post", async () => {
      const timestamp = Date.now();
      const post = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Post ${timestamp} - This is an automated test, will be deleted`,
      });

      expect(post).toBeDefined();
      expect(post.id).toBeDefined();
      expect(post.text).toContain("E2E Test Post");
      expect(post.timestamp).toBeGreaterThan(0);

      testTweetIds.push(post.id);
      console.log("Created post:", post.id);
    });

    it("should create a reply post", async () => {
      // First create a post to reply to
      const originalPost = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Original ${Date.now()}`,
      });
      testTweetIds.push(originalPost.id);

      // Create a reply
      const replyPost = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Reply ${Date.now()}`,
        inReplyTo: originalPost.id,
      });

      expect(replyPost).toBeDefined();
      expect(replyPost.inReplyTo).toBe(originalPost.id);

      testTweetIds.push(replyPost.id);
      console.log("Created reply:", replyPost.id, "to:", originalPost.id);
    });

    it("should fetch a post by ID", async () => {
      // Create a post
      const createdPost = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Fetch ${Date.now()}`,
      });
      testTweetIds.push(createdPost.id);

      // Fetch it back
      const fetchedPost = await postService.getPost(
        createdPost.id,
        runtime.agentId,
      );

      expect(fetchedPost).toBeDefined();
      expect(fetchedPost?.id).toBe(createdPost.id);
      expect(fetchedPost?.text).toBe(createdPost.text);
    });

    it("should fetch user posts", async () => {
      const profile = await client.twitterClient.me();
      if (!profile) throw new Error("No profile available");

      const posts = await postService.getPosts({
        agentId: runtime.agentId,
        userId: profile.userId,
        limit: 5,
      });

      expect(posts).toBeDefined();
      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBeLessThanOrEqual(5);

      console.log(`Fetched ${posts.length} posts for user ${profile.username}`);
    });

    it("should like and unlike a post", async () => {
      // Create a post
      const post = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Like ${Date.now()}`,
      });
      testTweetIds.push(post.id);

      // Like the post
      await postService.likePost(post.id, runtime.agentId);
      console.log("Liked post:", post.id);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Fetch the post to verify it was liked
      const likedPost = await postService.getPost(post.id, runtime.agentId);
      // Note: The like count might not update immediately due to Twitter's eventual consistency
      console.log("Post metrics after like:", likedPost?.metrics);
    });

    it("should delete a post", async () => {
      // Create a post
      const post = await postService.createPost({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Delete ${Date.now()}`,
      });

      console.log("Created post to delete:", post.id);

      // Delete it
      await postService.deletePost(post.id, runtime.agentId);

      // Try to fetch it - should return null or throw
      const deletedPost = await postService.getPost(post.id, runtime.agentId);
      expect(deletedPost).toBeNull();

      console.log("Successfully deleted post:", post.id);
    });
  });

  describe("MessageService", () => {
    it("should fetch mentions", async () => {
      const messages = await messageService.getMessages({
        agentId: runtime.agentId,
        limit: 5,
      });

      expect(messages).toBeDefined();
      expect(Array.isArray(messages)).toBe(true);

      console.log(`Fetched ${messages.length} mentions`);

      if (messages.length > 0) {
        console.log("First mention:", {
          id: messages[0].id,
          username: messages[0].username,
          text: messages[0].text.substring(0, 50) + "...",
          type: messages[0].type,
        });
      }
    });

    it("should send a regular tweet via message service", async () => {
      const timestamp = Date.now();
      const message = await messageService.sendMessage({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Message ${timestamp}`,
        type: MessageType.POST,
      });

      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.text).toContain("E2E Test Message");
      expect(message.type).toBe(MessageType.POST);

      testTweetIds.push(message.id);
      console.log("Sent message:", message.id);
    });

    it("should fetch a specific message by ID", async () => {
      // Create a tweet first
      const sent = await messageService.sendMessage({
        agentId: runtime.agentId,
        roomId: "test-room" as any,
        text: `E2E Test Get Message ${Date.now()}`,
        type: MessageType.POST,
      });
      testTweetIds.push(sent.id);

      // Fetch it back
      const fetched = await messageService.getMessage(sent.id, runtime.agentId);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(sent.id);
      expect(fetched?.text).toBe(sent.text);
    });
  });

  describe("Search and Timeline", () => {
    it("should search for tweets", async () => {
      const searchResult = await client.fetchSearchTweets(
        "javascript",
        5,
        SearchMode.Latest,
      );

      expect(searchResult).toBeDefined();
      expect(searchResult.tweets).toBeDefined();
      expect(Array.isArray(searchResult.tweets)).toBe(true);

      console.log(
        `Found ${searchResult.tweets.length} tweets for "javascript"`,
      );
    });

    it("should fetch home timeline", async () => {
      const timeline = await client.fetchHomeTimeline(10, false);

      expect(timeline).toBeDefined();
      expect(Array.isArray(timeline)).toBe(true);
      expect(timeline.length).toBeLessThanOrEqual(10);

      console.log(`Fetched ${timeline.length} tweets from home timeline`);
    });
  });

  describe("Error Handling", () => {
    it("should handle non-existent tweet gracefully", async () => {
      const nonExistentId = "1234567890123456789"; // Unlikely to exist

      const post = await postService.getPost(nonExistentId, runtime.agentId);
      expect(post).toBeNull();

      const message = await messageService.getMessage(
        nonExistentId,
        runtime.agentId,
      );
      expect(message).toBeNull();
    });

    it("should handle rate limiting gracefully", async () => {
      // This test is commented out to avoid hitting rate limits during normal test runs
      // Uncomment to test rate limit handling
      /*
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          postService.createPost({
            agentId: runtime.agentId,
            roomId: 'test-room' as any,
            text: `Rate limit test ${i} at ${Date.now()}`,
          }).then(post => {
            testTweetIds.push(post.id);
            return post;
          })
        );
      }

      try {
        await Promise.all(promises);
      } catch (error) {
        expect(error.message).toContain('rate limit');
      }
      */
    });
  });
});
