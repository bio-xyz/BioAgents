import {
  ChannelType,
  type Content,
  type IAgentRuntime,
  type Memory,
  type UUID,
  createUniqueUuid,
  logger,
  ModelType,
} from '@elizaos/core';
import type { ClientBase } from './base';
import type { MediaData } from './types';
import { sendTweet } from './utils';
import { getSetting } from './utils/settings';
import { getRandomInterval } from './environment';
import {
  addToRecentTweets,
  isDuplicateTweet,
  ensureTwitterContext,
  createMemorySafe,
} from './utils/memory';
import { generateHypothesis, showcaseRecentPaper, generateNewsPost } from './utils/science-utils';
import { KnowledgeGraphService } from '@elizaos/plugin-kg';

/**
 * Class representing a Twitter post client for generating and posting tweets.
 */
export class TwitterPostClient {
  client: ClientBase;
  runtime: IAgentRuntime;
  twitterUsername: string;
  private isDryRun: boolean;
  private state: any;
  private isRunning: boolean = false;
  private isPosting: boolean = false; // Add lock to prevent concurrent posting

  /**
   * Creates an instance of TwitterPostClient.
   * @param {ClientBase} client - The client instance.
   * @param {IAgentRuntime} runtime - The runtime instance.
   * @param {any} state - The state object containing configuration settings
   */
  constructor(client: ClientBase, runtime: IAgentRuntime, state: any) {
    this.client = client;
    this.state = state;
    this.runtime = runtime;
    const dryRunSetting =
      this.state?.TWITTER_DRY_RUN ??
      getSetting(this.runtime, 'TWITTER_DRY_RUN') ??
      process.env.TWITTER_DRY_RUN;
    this.isDryRun =
      dryRunSetting === true ||
      dryRunSetting === 'true' ||
      (typeof dryRunSetting === 'string' && dryRunSetting.toLowerCase() === 'true');

    // Log configuration on initialization
    logger.log('Twitter Post Client Configuration:');
    logger.log(`- Dry Run Mode: ${this.isDryRun ? 'Enabled' : 'Disabled'}`);

    const postIntervalMin = parseInt(
      this.state?.TWITTER_POST_INTERVAL_MIN ||
        (getSetting(this.runtime, 'TWITTER_POST_INTERVAL_MIN') as string) ||
        process.env.TWITTER_POST_INTERVAL_MIN ||
        '90'
    );
    const postIntervalMax = parseInt(
      this.state?.TWITTER_POST_INTERVAL_MAX ||
        (getSetting(this.runtime, 'TWITTER_POST_INTERVAL_MAX') as string) ||
        process.env.TWITTER_POST_INTERVAL_MAX ||
        '150'
    );
    logger.log(`- Post Interval: ${postIntervalMin}-${postIntervalMax} minutes (randomized)`);
  }

  /**
   * Stops the Twitter post client
   */
  async stop() {
    logger.log('Stopping Twitter post client...');
    this.isRunning = false;
  }

  /**
   * Starts the Twitter post client, setting up a loop to periodically generate new tweets.
   */
  async start() {
    logger.log('Starting Twitter post client...');
    this.isRunning = true;

    const generateNewTweetLoop = async () => {
      if (!this.isRunning) {
        logger.log('Twitter post client stopped, exiting loop');
        return;
      }

      await this.generateNewTweet();

      if (!this.isRunning) {
        logger.log('Twitter post client stopped after tweet, exiting loop');
        return;
      }

      // Get random post interval in minutes
      const postIntervalMinutes = getRandomInterval(this.runtime, 'post');

      // Convert to milliseconds
      const interval = postIntervalMinutes * 60 * 1000;

      logger.info(`Next tweet scheduled in ${postIntervalMinutes.toFixed(1)} minutes`);

      // Wait for the interval AFTER generating the tweet
      await new Promise((resolve) => setTimeout(resolve, interval));

      if (this.isRunning) {
        // Schedule the next iteration
        generateNewTweetLoop();
      }
    };

    // Wait a bit longer to ensure profile is loaded
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check if we should generate a tweet immediately
    const postImmediately =
      this.state?.TWITTER_POST_IMMEDIATELY ||
      (getSetting(this.runtime, 'TWITTER_POST_IMMEDIATELY') as string) ||
      process.env.TWITTER_POST_IMMEDIATELY;

    if (postImmediately === 'true' || postImmediately === true) {
      logger.info('TWITTER_POST_IMMEDIATELY is true, generating initial tweet now');
      // Try multiple times in case profile isn't ready
      let retries = 0;
      while (retries < 5) {
        const success = await this.generateNewTweet();
        if (success) break;

        retries++;
        logger.info(`Retrying immediate tweet (attempt ${retries}/5)...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    // Start the regular generation loop
    generateNewTweetLoop();
  }

  /**
   * Handles the creation and posting of a tweet by emitting standardized events.
   * This approach aligns with our platform-independent architecture.
   * @returns {Promise<boolean>} true if tweet was posted successfully
   */
  async generateNewTweet(): Promise<boolean> {
    logger.info('Attempting to generate new tweet...');

    // Prevent concurrent posting
    if (this.isPosting) {
      logger.info('Already posting a tweet, skipping concurrent attempt');
      return false;
    }

    this.isPosting = true;

    try {
      // Create the timeline room ID for storing the post
      const userId = this.client.profile?.id;
      if (!userId) {
        logger.error('Cannot generate tweet: Twitter profile not available');
        this.isPosting = false; // Reset flag
        return false;
      }

      logger.info(`Generating tweet for user: ${this.client.profile?.username} (${userId})`);

      // Create standardized world and room IDs
      const worldId = createUniqueUuid(this.runtime, userId) as UUID;
      const roomId = createUniqueUuid(this.runtime, `${userId}-home`) as UUID;

      // Generate tweet content using the runtime's model
      const state = await this.runtime
        .composeState({
          agentId: this.runtime.agentId,
          entityId: this.runtime.agentId,
          roomId,
          content: { text: '', type: 'post' },
          createdAt: Date.now(),
        } as Memory)
        .catch((error) => {
          logger.warn('Error composing state, using minimal state:', error);
          // Return minimal state if composition fails
          return {
            agentId: this.runtime.agentId,
            recentMemories: [],
            values: {},
          };
        });

      // randomly select between hypothesis, paper showcase, and news
      const random: number = 3;
      console.log('🔍 Random Twitter post option:', random);
      let tweetText = '';

      if (random == 1) {
        // hypothesis path
        logger.info('Generating hypothesis tweet...');
        const hypothesis = await generateHypothesis(
          this.runtime,
          // @ts-ignore
          this.runtime.getService('knowledge-graph') as KnowledgeGraphService
        );

        tweetText = hypothesis.hypothesis;

        // store to Knowledge Graph here
        const randomId = crypto.randomUUID();
        // @ts-ignore
        const kgService = this.runtime.getService('knowledge-graph') as KnowledgeGraphService;
        await kgService.insertJsonLD(
          {
            '@context': {
              dcterms: 'http://purl.org/dc/terms/',
              cito: 'http://purl.org/spar/cito/',
              deo: 'http://purl.org/spar/deo/',
            },
            '@id': `https://hypothesis.aubr.ai/${randomId}`,
            '@type': 'deo:FutureWork',
            'cito:usesDataFrom': hypothesis.dois,
            'dcterms:references': [hypothesis.hypothesis],
            'dcterms:creator': this.runtime.character?.name,
            'dcterms:created': new Date().toISOString(),
          },
          'https://hypothesis.aubr.ai'
        );

        logger.info(`[DRY RUN] Would post hypothesis: ${tweetText}`);
        return false;
      } else if (random == 2) {
        // showcase recent paper path
        logger.info('Generating paper showcase tweet...');
        const showcase = await showcaseRecentPaper(
          this.runtime,
          // @ts-ignore
          this.runtime.getService('knowledge-graph') as KnowledgeGraphService
        );

        if (showcase) {
          tweetText = showcase;
        } else {
          // Fallback to hypothesis if paper showcase fails
          logger.warn('Paper showcase failed, falling back to hypothesis generation');
          tweetText = (
            await generateHypothesis(
              this.runtime,
              // @ts-ignore
              this.runtime.getService('knowledge-graph') as KnowledgeGraphService
            )
          ).hypothesis;
        }
      } else if (random == 3) {
        // talk about recent news path
        logger.info('Generating news tweet...');
        const newsPost = await generateNewsPost(this.runtime);

        if (newsPost) {
          tweetText = newsPost;
        } else {
          // Fallback to hypothesis if news generation fails
          logger.warn('News generation failed, falling back to hypothesis generation');
          tweetText = (
            await generateHypothesis(
              this.runtime,
              // @ts-ignore
              this.runtime.getService('knowledge-graph') as KnowledgeGraphService
            )
          ).hypothesis;
        }
      }

      if (!tweetText || tweetText.length === 0) {
        logger.error('Generated empty tweet content');
        return false;
      }

      if (tweetText.includes('Error: Missing')) {
        logger.error('Error in generated content:', tweetText);
        return false;
      }

      logger.info(`Generated tweet: ${tweetText}`);

      // Post the tweet
      if (this.isDryRun) {
        logger.info(`[DRY RUN] Would post tweet: ${tweetText}`);
        return false;
      }

      const result = await this.postToTwitter(tweetText, []);

      // If result is null, it means we detected a duplicate tweet and skipped posting
      if (result === null) {
        logger.info('Skipped posting duplicate tweet');
        return false;
      }

      const tweetId = (result as any).id;
      logger.info(`Tweet posted successfully! ID: ${tweetId}`);

      if (result) {
        const postedTweetId = createUniqueUuid(this.runtime, tweetId);

        try {
          // Ensure context exists with error handling
          const context = await ensureTwitterContext(this.runtime, {
            userId,
            username: this.client.profile?.username || 'unknown',
            conversationId: `${userId}-home`,
          });

          // Create memory for the posted tweet with retry logic
          const postedMemory: Memory = {
            id: postedTweetId,
            entityId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: context.roomId,
            content: {
              text: tweetText,
              source: 'twitter',
              channelType: ChannelType.FEED,
              type: 'post',
              metadata: {
                tweetId,
                postedAt: Date.now(),
              },
            },
            createdAt: Date.now(),
          };

          await createMemorySafe(this.runtime, postedMemory, 'messages');
          logger.info('Tweet posted and saved to memory successfully');
        } catch (error) {
          logger.error('Failed to save tweet memory:', error);
          // Don't fail the tweet posting if memory creation fails
        }

        return true;
      }
    } catch (error) {
      logger.error('Error generating tweet:', error);
      return false;
    } finally {
      this.isPosting = false;
    }
  }

  /**
   * Posts content to Twitter
   * @param {string} text The tweet text to post
   * @param {MediaData[]} mediaData Optional media to attach to the tweet
   * @returns {Promise<any>} The result from the Twitter API
   */
  private async postToTwitter(text: string, mediaData: MediaData[] = []): Promise<any> {
    try {
      // Check if this tweet is a duplicate of recent tweets
      const username = this.client.profile?.username;
      if (!username) {
        logger.error('No profile username available');
        return null;
      }

      // Check for duplicates in recent tweets
      const isDuplicate = await isDuplicateTweet(this.runtime, username, text);
      if (isDuplicate) {
        logger.warn('Tweet is a duplicate of a recent post. Skipping to avoid duplicate.');
        return null;
      }

      // Handle media uploads if needed
      const mediaIds: string[] = [];

      if (mediaData && mediaData.length > 0) {
        for (const media of mediaData) {
          try {
            // TODO: Media upload will need to be updated to use the new API
            // For now, just log a warning that media upload is not supported
            logger.warn('Media upload not currently supported with the modern Twitter API');
          } catch (error) {
            logger.error('Error uploading media:', error);
          }
        }
      }

      const result = await sendTweet(this.client, text, mediaData);

      // Add to recent tweets cache to prevent future duplicates
      await addToRecentTweets(this.runtime, username, text);

      return result;
    } catch (error) {
      logger.error('Error posting to Twitter:', error);
      throw error;
    }
  }
}
