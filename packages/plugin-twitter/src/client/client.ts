import type {
  TTweetv2Expansion,
  TTweetv2MediaField,
  TTweetv2PlaceField,
  TTweetv2PollField,
  TTweetv2TweetField,
  TTweetv2UserField,
} from "twitter-api-v2";
import {
  type FetchTransformOptions,
  type QueryProfilesResponse,
  type QueryTweetsResponse,
  type RequestApiResult,
} from "./api-types";
import { TwitterAuth } from "./auth";
// Removed messages imports - using Twitter API v2 instead
import {
  type Profile,
  getEntityIdByScreenName,
  getProfile,
  getScreenNameByUserId,
} from "./profile";
import {
  fetchProfileFollowers,
  fetchProfileFollowing,
  followUser,
  getFollowers,
  getFollowing,
} from "./relationships";
import {
  SearchMode,
  searchProfiles,
  searchTweets,
  searchQuotedTweets,
} from "./search";

import {
  type PollData,
  type Retweeter,
  type Tweet,
  type TweetQuery,
  createCreateLongTweetRequest,
  createCreateNoteTweetRequest,
  createCreateTweetRequest,
  createCreateTweetRequestV2,
  createQuoteTweetRequest,
  defaultOptions,
  deleteTweet,
  fetchListTweets,
  getAllRetweeters,
  getLatestTweet,
  getTweet,
  getTweetV2,
  getTweets,
  getTweetsAndReplies,
  getTweetsAndRepliesByUserId,
  getTweetsByUserId,
  getTweetsV2,
  getTweetsWhere,
  likeTweet,
  retweet,
  getTweetWhere,
  parseTweetV2ToV1,
} from "./tweets";

const twUrl = "https://twitter.com";

/**
 * An alternative fetch function to use instead of the default fetch function. This may be useful
 * in nonstandard runtime environments, such as edge workers.
 *
 * @param {typeof fetch} fetch - The fetch function to use.
 *
 * @param {Partial<FetchTransformOptions>} transform - Additional options that control how requests
 * and responses are processed. This can be used to proxy requests through other hosts, for example.
 */
export interface ClientOptions {
  /**
   * An alternative fetch function to use instead of the default fetch function. This may be useful
   * in nonstandard runtime environments, such as edge workers.
   */
  fetch: typeof fetch;

  /**
   * Additional options that control how requests and responses are processed. This can be used to
   * proxy requests through other hosts, for example.
   */
  transform: Partial<FetchTransformOptions>;
}

/**
 * An interface to Twitter's API v2.
 * - Reusing Client objects is recommended to minimize the time spent authenticating unnecessarily.
 */
export class Client {
  private auth?: TwitterAuth;

  /**
   * Creates a new Client object.
   * - Reusing Client objects is recommended to minimize the time spent authenticating unnecessarily.
   */
  constructor(private readonly options?: Partial<ClientOptions>) {}

  /**
   * Fetches a Twitter profile.
   * @param username The Twitter username of the profile to fetch, without an `@` at the beginning.
   * @returns The requested {@link Profile}.
   */
  public async getProfile(username: string): Promise<Profile> {
    const res = await getProfile(username, this.auth);
    return this.handleResponse(res);
  }

  /**
   * Fetches the user ID corresponding to the provided screen name.
   * @param screenName The Twitter screen name of the profile to fetch.
   * @returns The ID of the corresponding account.
   */
  public async getEntityIdByScreenName(screenName: string): Promise<string> {
    const res = await getEntityIdByScreenName(screenName, this.auth);
    return this.handleResponse(res);
  }

  /**
   *
   * @param userId The user ID of the profile to fetch.
   * @returns The screen name of the corresponding account.
   */
  public async getScreenNameByUserId(userId: string): Promise<string> {
    const response = await getScreenNameByUserId(userId, this.auth);
    return this.handleResponse(response);
  }

  /**
   * Fetches tweets from Twitter.
   * @param query The search query. Any Twitter-compatible query format can be used.
   * @param maxTweets The maximum number of tweets to return.
   * @param includeReplies Whether or not replies should be included in the response.
   * @param searchMode The category filter to apply to the search. Defaults to `Top`.
   * @returns An {@link AsyncGenerator} of tweets matching the provided filters.
   */
  public searchTweets(
    query: string,
    maxTweets: number,
    searchMode: SearchMode = SearchMode.Top,
  ): AsyncGenerator<Tweet, void> {
    return searchTweets(query, maxTweets, searchMode, this.auth);
  }

  /**
   * Fetches profiles from Twitter.
   * @param query The search query. Any Twitter-compatible query format can be used.
   * @param maxProfiles The maximum number of profiles to return.
   * @returns An {@link AsyncGenerator} of tweets matching the provided filter(s).
   */
  public searchProfiles(
    query: string,
    maxProfiles: number,
  ): AsyncGenerator<Profile, void> {
    return searchProfiles(query, maxProfiles, this.auth);
  }

  /**
   * Fetches tweets from Twitter.
   * @param query The search query. Any Twitter-compatible query format can be used.
   * @param maxTweets The maximum number of tweets to return.
   * @param includeReplies Whether or not replies should be included in the response.
   * @param searchMode The category filter to apply to the search. Defaults to `Top`.
   * @param cursor The search cursor, which can be passed into further requests for more results.
   * @returns A page of results, containing a cursor that can be used in further requests.
   */
  public async fetchSearchTweets(
    query: string,
    maxTweets: number,
    searchMode: SearchMode,
    cursor?: string,
  ): Promise<QueryTweetsResponse> {
    // Use the generator and collect results
    const tweets: Tweet[] = [];
    const generator = searchTweets(query, maxTweets, searchMode, this.auth);

    for await (const tweet of generator) {
      tweets.push(tweet);
    }

    return {
      tweets,
      // v2 API doesn't provide cursor-based pagination for search
      next: undefined,
    };
  }

  /**
   * Fetches profiles from Twitter.
   * @param query The search query. Any Twitter-compatible query format can be used.
   * @param maxProfiles The maximum number of profiles to return.
   * @param cursor The search cursor, which can be passed into further requests for more results.
   * @returns A page of results, containing a cursor that can be used in further requests.
   */
  public async fetchSearchProfiles(
    query: string,
    maxProfiles: number,
    cursor?: string,
  ): Promise<QueryProfilesResponse> {
    // Use the generator and collect results
    const profiles: Profile[] = [];
    const generator = searchProfiles(query, maxProfiles, this.auth);

    for await (const profile of generator) {
      profiles.push(profile);
    }

    return {
      profiles,
      // v2 API doesn't provide cursor-based pagination for search
      next: undefined,
    };
  }

  /**
   * Fetches list tweets from Twitter.
   * @param listId The list id
   * @param maxTweets The maximum number of tweets to return.
   * @param cursor The search cursor, which can be passed into further requests for more results.
   * @returns A page of results, containing a cursor that can be used in further requests.
   */
  public fetchListTweets(
    listId: string,
    maxTweets: number,
    cursor?: string,
  ): Promise<QueryTweetsResponse> {
    return fetchListTweets(listId, maxTweets, cursor, this.auth);
  }

  /**
   * Fetch the profiles a user is following
   * @param userId The user whose following should be returned
   * @param maxProfiles The maximum number of profiles to return.
   * @returns An {@link AsyncGenerator} of following profiles for the provided user.
   */
  public getFollowing(
    userId: string,
    maxProfiles: number,
  ): AsyncGenerator<Profile, void> {
    return getFollowing(userId, maxProfiles, this.auth);
  }

  /**
   * Fetch the profiles that follow a user
   * @param userId The user whose followers should be returned
   * @param maxProfiles The maximum number of profiles to return.
   * @returns An {@link AsyncGenerator} of profiles following the provided user.
   */
  public getFollowers(
    userId: string,
    maxProfiles: number,
  ): AsyncGenerator<Profile, void> {
    return getFollowers(userId, maxProfiles, this.auth);
  }

  /**
   * Fetches following profiles from Twitter.
   * @param userId The user whose following should be returned
   * @param maxProfiles The maximum number of profiles to return.
   * @param cursor The search cursor, which can be passed into further requests for more results.
   * @returns A page of results, containing a cursor that can be used in further requests.
   */
  public fetchProfileFollowing(
    userId: string,
    maxProfiles: number,
    cursor?: string,
  ): Promise<QueryProfilesResponse> {
    return fetchProfileFollowing(userId, maxProfiles, this.auth, cursor);
  }

  /**
   * Fetches profile followers from Twitter.
   * @param userId The user whose following should be returned
   * @param maxProfiles The maximum number of profiles to return.
   * @param cursor The search cursor, which can be passed into further requests for more results.
   * @returns A page of results, containing a cursor that can be used in further requests.
   */
  public fetchProfileFollowers(
    userId: string,
    maxProfiles: number,
    cursor?: string,
  ): Promise<QueryProfilesResponse> {
    return fetchProfileFollowers(userId, maxProfiles, this.auth, cursor);
  }

  /**
   * Fetches the home timeline for the current user using Twitter API v2.
   * Note: Twitter API v2 doesn't distinguish between "For You" and "Following" feeds.
   * @param count The number of tweets to fetch.
   * @param seenTweetIds An array of tweet IDs that have already been seen (not used in v2).
   * @returns A promise that resolves to an array of tweets.
   */
  public async fetchHomeTimeline(
    count: number,
    seenTweetIds: string[],
  ): Promise<Tweet[]> {
    if (!this.auth) {
      throw new Error("Not authenticated");
    }

    const client = this.auth.getV2Client();

    try {
      const timeline = await client.v2.homeTimeline({
        max_results: Math.min(count, 100),
        "tweet.fields": [
          "id",
          "text",
          "created_at",
          "author_id",
          "referenced_tweets",
          "entities",
          "public_metrics",
          "attachments",
          "conversation_id",
        ],
        "user.fields": ["id", "name", "username", "profile_image_url"],
        "media.fields": ["url", "preview_image_url", "type"],
        expansions: [
          "author_id",
          "attachments.media_keys",
          "referenced_tweets.id",
        ],
      });

      const tweets: Tweet[] = [];
      for await (const tweet of timeline) {
        tweets.push(parseTweetV2ToV1(tweet, timeline.includes));
        if (tweets.length >= count) break;
      }

      return tweets;
    } catch (error) {
      console.error("Failed to fetch home timeline:", error);
      throw error;
    }
  }

  /**
   * Fetches the home timeline for the current user (same as fetchHomeTimeline in v2).
   * Twitter API v2 doesn't provide separate "Following" timeline endpoint.
   * @param count The number of tweets to fetch.
   * @param seenTweetIds An array of tweet IDs that have already been seen (not used in v2).
   * @returns A promise that resolves to an array of tweets.
   */
  public async fetchFollowingTimeline(
    count: number,
    seenTweetIds: string[],
  ): Promise<Tweet[]> {
    // In v2 API, there's no separate following timeline endpoint
    // Use the same home timeline endpoint
    return this.fetchHomeTimeline(count, seenTweetIds);
  }

  async getUserTweets(
    userId: string,
    maxTweets = 200,
    cursor?: string,
  ): Promise<{ tweets: Tweet[]; next?: string }> {
    if (!this.auth) {
      throw new Error("Not authenticated");
    }

    const client = this.auth.getV2Client();

    try {
      const response = await client.v2.userTimeline(userId, {
        max_results: Math.min(maxTweets, 100),
        "tweet.fields": [
          "id",
          "text",
          "created_at",
          "author_id",
          "referenced_tweets",
          "entities",
          "public_metrics",
          "attachments",
          "conversation_id",
        ],
        "user.fields": ["id", "name", "username", "profile_image_url"],
        "media.fields": ["url", "preview_image_url", "type"],
        expansions: [
          "author_id",
          "attachments.media_keys",
          "referenced_tweets.id",
        ],
        pagination_token: cursor,
      });

      const tweets: Tweet[] = [];
      for await (const tweet of response) {
        tweets.push(parseTweetV2ToV1(tweet, response.includes));
        if (tweets.length >= maxTweets) break;
      }

      return {
        tweets,
        next: response.meta?.next_token,
      };
    } catch (error) {
      console.error("Failed to fetch user tweets:", error);
      throw error;
    }
  }

  async *getUserTweetsIterator(
    userId: string,
    maxTweets = 200,
  ): AsyncGenerator<Tweet, void> {
    let cursor: string | undefined;
    let retrievedTweets = 0;

    while (retrievedTweets < maxTweets) {
      const response = await this.getUserTweets(
        userId,
        maxTweets - retrievedTweets,
        cursor,
      );

      for (const tweet of response.tweets) {
        yield tweet;
        retrievedTweets++;
        if (retrievedTweets >= maxTweets) {
          break;
        }
      }

      cursor = response.next;

      if (!cursor) {
        break;
      }
    }
  }

  /**
   * Fetches the current trends from Twitter.
   * @returns The current list of trends.
   */
  public getTrends(): Promise<string[]> {
    // Trends API not available in Twitter API v2 with current implementation
    console.warn("Trends API not available in Twitter API v2");
    return Promise.resolve([]);
  }

  /**
   * Fetches tweets from a Twitter user.
   * @param user The user whose tweets should be returned.
   * @param maxTweets The maximum number of tweets to return. Defaults to `200`.
   * @returns An {@link AsyncGenerator} of tweets from the provided user.
   */
  public getTweets(user: string, maxTweets = 200): AsyncGenerator<Tweet> {
    return getTweets(user, maxTweets, this.auth);
  }

  /**
   * Fetches tweets from a Twitter user using their ID.
   * @param userId The user whose tweets should be returned.
   * @param maxTweets The maximum number of tweets to return. Defaults to `200`.
   * @returns An {@link AsyncGenerator} of tweets from the provided user.
   */
  public getTweetsByUserId(
    userId: string,
    maxTweets = 200,
  ): AsyncGenerator<Tweet, void> {
    return getTweetsByUserId(userId, maxTweets, this.auth);
  }

  /**
   * Send a tweet
   * @param text The text of the tweet
   * @param tweetId The id of the tweet to reply to
   * @param mediaData Optional media data
   * @returns
   */

  async sendTweet(
    text: string,
    replyToTweetId?: string,
    mediaData?: { data: Buffer; mediaType: string }[],
    hideLinkPreview?: boolean,
  ) {
    if (!text || text.trim().length === 0) {
      throw new Error("Text is required");
    }
    if (text.toLowerCase().startsWith("error:")) {
      throw new Error("Error sending tweet: " + text);
    }
    return await createCreateTweetRequest(
      text,
      this.auth,
      replyToTweetId,
      mediaData,
      hideLinkPreview,
    );
  }

  async sendNoteTweet(
    text: string,
    replyToTweetId?: string,
    mediaData?: { data: Buffer; mediaType: string }[],
  ) {
    if (!text || text.trim().length === 0) {
      throw new Error("Text is required");
    }
    if (text.toLowerCase().startsWith("error:")) {
      throw new Error("Error sending note tweet: " + text);
    }
    return await createCreateNoteTweetRequest(
      text,
      this.auth,
      replyToTweetId,
      mediaData,
    );
  }

  /**
   * Send a long tweet (Note Tweet)
   * @param text The text of the tweet
   * @param tweetId The id of the tweet to reply to
   * @param mediaData Optional media data
   * @returns
   */
  async sendLongTweet(
    text: string,
    replyToTweetId?: string,
    mediaData?: { data: Buffer; mediaType: string }[],
  ) {
    return await createCreateLongTweetRequest(
      text,
      this.auth,
      replyToTweetId,
      mediaData,
    );
  }

  /**
   * Send a tweet
   * @param text The text of the tweet
   * @param tweetId The id of the tweet to reply to
   * @param options The options for the tweet
   * @returns
   */

  async sendTweetV2(
    text: string,
    replyToTweetId?: string,
    options?: {
      poll?: PollData;
    },
  ) {
    return await createCreateTweetRequestV2(
      text,
      this.auth,
      replyToTweetId,
      options,
    );
  }

  /**
   * Fetches tweets and replies from a Twitter user.
   * @param user The user whose tweets should be returned.
   * @param maxTweets The maximum number of tweets to return. Defaults to `200`.
   * @returns An {@link AsyncGenerator} of tweets from the provided user.
   */
  public getTweetsAndReplies(
    user: string,
    maxTweets = 200,
  ): AsyncGenerator<Tweet> {
    return getTweetsAndReplies(user, maxTweets, this.auth);
  }

  /**
   * Fetches tweets and replies from a Twitter user using their ID.
   * @param userId The user whose tweets should be returned.
   * @param maxTweets The maximum number of tweets to return. Defaults to `200`.
   * @returns An {@link AsyncGenerator} of tweets from the provided user.
   */
  public getTweetsAndRepliesByUserId(
    userId: string,
    maxTweets = 200,
  ): AsyncGenerator<Tweet, void> {
    return getTweetsAndRepliesByUserId(userId, maxTweets, this.auth);
  }

  /**
   * Fetches the first tweet matching the given query.
   *
   * Example:
   * ```js
   * const timeline = client.getTweets('user', 200);
   * const retweet = await client.getTweetWhere(timeline, { isRetweet: true });
   * ```
   * @param tweets The {@link AsyncIterable} of tweets to search through.
   * @param query A query to test **all** tweets against. This may be either an
   * object of key/value pairs or a predicate. If this query is an object, all
   * key/value pairs must match a {@link Tweet} for it to be returned. If this query
   * is a predicate, it must resolve to `true` for a {@link Tweet} to be returned.
   * - All keys are optional.
   * - If specified, the key must be implemented by that of {@link Tweet}.
   */
  public getTweetWhere(
    tweets: AsyncIterable<Tweet>,
    query: TweetQuery,
  ): Promise<Tweet | null> {
    return getTweetWhere(tweets, query);
  }

  /**
   * Fetches all tweets matching the given query.
   *
   * Example:
   * ```js
   * const timeline = client.getTweets('user', 200);
   * const retweets = await client.getTweetsWhere(timeline, { isRetweet: true });
   * ```
   * @param tweets The {@link AsyncIterable} of tweets to search through.
   * @param query A query to test **all** tweets against. This may be either an
   * object of key/value pairs or a predicate. If this query is an object, all
   * key/value pairs must match a {@link Tweet} for it to be returned. If this query
   * is a predicate, it must resolve to `true` for a {@link Tweet} to be returned.
   * - All keys are optional.
   * - If specified, the key must be implemented by that of {@link Tweet}.
   */
  public getTweetsWhere(
    tweets: AsyncIterable<Tweet>,
    query: TweetQuery,
  ): Promise<Tweet[]> {
    return getTweetsWhere(tweets, query);
  }

  /**
   * Fetches the most recent tweet from a Twitter user.
   * @param user The user whose latest tweet should be returned.
   * @param includeRetweets Whether or not to include retweets. Defaults to `false`.
   * @returns The {@link Tweet} object or `null`/`undefined` if it couldn't be fetched.
   */
  public getLatestTweet(
    user: string,
    includeRetweets = false,
    max = 200,
  ): Promise<Tweet | null | undefined> {
    return getLatestTweet(user, includeRetweets, max, this.auth);
  }

  /**
   * Fetches a single tweet.
   * @param id The ID of the tweet to fetch.
   * @returns The {@link Tweet} object, or `null` if it couldn't be fetched.
   */
  public getTweet(id: string): Promise<Tweet | null> {
    return getTweet(id, this.auth);
  }

  /**
   * Fetches a single tweet by ID using the Twitter API v2.
   * Allows specifying optional expansions and fields for more detailed data.
   *
   * @param {string} id - The ID of the tweet to fetch.
   * @param {Object} [options] - Optional parameters to customize the tweet data.
   * @param {string[]} [options.expansions] - Array of expansions to include, e.g., 'attachments.poll_ids'.
   * @param {string[]} [options.tweetFields] - Array of tweet fields to include, e.g., 'created_at', 'public_metrics'.
   * @param {string[]} [options.pollFields] - Array of poll fields to include, if the tweet has a poll, e.g., 'options', 'end_datetime'.
   * @param {string[]} [options.mediaFields] - Array of media fields to include, if the tweet includes media, e.g., 'url', 'preview_image_url'.
   * @param {string[]} [options.userFields] - Array of user fields to include, if user information is requested, e.g., 'username', 'verified'.
   * @param {string[]} [options.placeFields] - Array of place fields to include, if the tweet includes location data, e.g., 'full_name', 'country'.
   * @returns {Promise<TweetV2 | null>} - The tweet data, including requested expansions and fields.
   */
  async getTweetV2(
    id: string,
    options: {
      expansions?: TTweetv2Expansion[];
      tweetFields?: TTweetv2TweetField[];
      pollFields?: TTweetv2PollField[];
      mediaFields?: TTweetv2MediaField[];
      userFields?: TTweetv2UserField[];
      placeFields?: TTweetv2PlaceField[];
    } = defaultOptions,
  ): Promise<Tweet | null> {
    return await getTweetV2(id, this.auth, options);
  }

  /**
   * Fetches multiple tweets by IDs using the Twitter API v2.
   * Allows specifying optional expansions and fields for more detailed data.
   *
   * @param {string[]} ids - Array of tweet IDs to fetch.
   * @param {Object} [options] - Optional parameters to customize the tweet data.
   * @param {string[]} [options.expansions] - Array of expansions to include, e.g., 'attachments.poll_ids'.
   * @param {string[]} [options.tweetFields] - Array of tweet fields to include, e.g., 'created_at', 'public_metrics'.
   * @param {string[]} [options.pollFields] - Array of poll fields to include, if tweets contain polls, e.g., 'options', 'end_datetime'.
   * @param {string[]} [options.mediaFields] - Array of media fields to include, if tweets contain media, e.g., 'url', 'preview_image_url'.
   * @param {string[]} [options.userFields] - Array of user fields to include, if user information is requested, e.g., 'username', 'verified'.
   * @param {string[]} [options.placeFields] - Array of place fields to include, if tweets contain location data, e.g., 'full_name', 'country'.
   * @returns {Promise<TweetV2[]> } - Array of tweet data, including requested expansions and fields.
   */
  async getTweetsV2(
    ids: string[],
    options: {
      expansions?: TTweetv2Expansion[];
      tweetFields?: TTweetv2TweetField[];
      pollFields?: TTweetv2PollField[];
      mediaFields?: TTweetv2MediaField[];
      userFields?: TTweetv2UserField[];
      placeFields?: TTweetv2PlaceField[];
    } = defaultOptions,
  ): Promise<Tweet[]> {
    return await getTweetsV2(ids, this.auth, options);
  }

  /**
   * Updates the authentication state for the client.
   * @param auth The new authentication.
   */
  public updateAuth(auth: TwitterAuth) {
    this.auth = auth;
  }

  /**
   * Get current authentication credentials
   * @returns {TwitterAuth | null} Current authentication or null if not authenticated
   */
  public getAuth(): TwitterAuth | null {
    return this.auth;
  }

  /**
   * Check if client is properly authenticated with Twitter API v2 credentials
   * @returns {boolean} True if authenticated
   */
  public isAuthenticated(): boolean {
    if (!this.auth) return false;
    return this.auth.hasToken();
  }

  /**
   * Returns if the client is logged in as a real user.
   * @returns `true` if the client is logged in with a real user account; otherwise `false`.
   */
  public async isLoggedIn(): Promise<boolean> {
    return await this.auth.isLoggedIn();
  }

  /**
   * Returns the currently logged in user
   * @returns The currently logged in user
   */
  public async me(): Promise<Profile | undefined> {
    return this.auth.me();
  }

  /**
   * Login to Twitter using API v2 credentials only.
   * @param appKey The API key
   * @param appSecret The API secret key
   * @param accessToken The access token
   * @param accessSecret The access token secret
   */
  public async login(
    username: string,
    password: string,
    email?: string,
    twoFactorSecret?: string,
    appKey?: string,
    appSecret?: string,
    accessToken?: string,
    accessSecret?: string,
  ): Promise<void> {
    // Only use API credentials for v2 authentication
    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      throw new Error(
        "Twitter API v2 credentials are required for authentication",
      );
    }

    this.auth = new TwitterAuth(appKey, appSecret, accessToken, accessSecret);
  }

  /**
   * Log out of Twitter.
   * Note: With API v2, logout is not applicable as we use API credentials.
   */
  public async logout(): Promise<void> {
    // With API v2 credentials, there's no logout process
    console.warn(
      "Logout is not applicable when using Twitter API v2 credentials",
    );
  }

  /**
   * Sends a quote tweet.
   * @param text The text of the tweet.
   * @param quotedTweetId The ID of the tweet to quote.
   * @param options Optional parameters, such as media data.
   * @returns The response from the Twitter API.
   */
  public async sendQuoteTweet(
    text: string,
    quotedTweetId: string,
    options?: {
      mediaData: { data: Buffer; mediaType: string }[];
    },
  ) {
    return await createQuoteTweetRequest(
      text,
      quotedTweetId,
      this.auth,
      options?.mediaData,
    );
  }

  /**
   * Delete a tweet with the given ID.
   * @param tweetId The ID of the tweet to delete.
   * @returns A promise that resolves when the tweet is deleted.
   */
  public async deleteTweet(tweetId: string): Promise<any> {
    // Call the deleteTweet function from tweets.ts
    return await deleteTweet(tweetId, this.auth);
  }

  /**
   * Likes a tweet with the given tweet ID.
   * @param tweetId The ID of the tweet to like.
   * @returns A promise that resolves when the tweet is liked.
   */
  public async likeTweet(tweetId: string): Promise<void> {
    // Call the likeTweet function from tweets.ts
    await likeTweet(tweetId, this.auth);
  }

  /**
   * Retweets a tweet with the given tweet ID.
   * @param tweetId The ID of the tweet to retweet.
   * @returns A promise that resolves when the tweet is retweeted.
   */
  public async retweet(tweetId: string): Promise<void> {
    // Call the retweet function from tweets.ts
    await retweet(tweetId, this.auth);
  }

  /**
   * Follows a user with the given user ID.
   * @param userId The user ID of the user to follow.
   * @returns A promise that resolves when the user is followed.
   */
  public async followUser(userName: string): Promise<void> {
    // Call the followUser function from relationships.ts
    await followUser(userName, this.auth);
  }

  /**
   * Fetches direct message conversations
   * Note: This functionality requires additional permissions and is not implemented in the current Twitter API v2 wrapper
   * @param userId User ID
   * @param cursor Pagination cursor
   * @returns Array of DM conversations
   */
  public async getDirectMessageConversations(
    userId: string,
    cursor?: string,
  ): Promise<any> {
    console.warn(
      "Direct message conversations not implemented for Twitter API v2",
    );
    return { conversations: [] };
  }

  /**
   * Sends a direct message to a user.
   * Note: This functionality requires additional permissions and is not implemented in the current Twitter API v2 wrapper
   * @param conversationId The ID of the conversation
   * @param text The text of the message
   * @returns The response from the Twitter API
   */
  public async sendDirectMessage(
    conversationId: string,
    text: string,
  ): Promise<any> {
    console.warn("Sending direct messages not implemented for Twitter API v2");
    throw new Error("Direct message sending not implemented");
  }

  private getAuthOptions(): Partial<{ fetch?: typeof fetch; transform?: any }> {
    return {
      fetch: this.options?.fetch,
      transform: this.options?.transform,
    };
  }

  private handleResponse<T>(res: RequestApiResult<T>): T {
    if (!res.success) {
      throw (res as any).err;
    }

    return res.value;
  }

  /**
   * Retrieves all users who retweeted the given tweet.
   * @param tweetId The ID of the tweet.
   * @returns An array of users (retweeters).
   */
  public async getRetweetersOfTweet(tweetId: string): Promise<Retweeter[]> {
    return await getAllRetweeters(tweetId, this.auth);
  }

  /**
   * Fetches all quoted tweets for a given tweet ID, handling pagination automatically.
   * @param tweetId The ID of the tweet to fetch quotes for.
   * @param maxQuotes Maximum number of quotes to return (default: 100).
   * @returns An array of all quoted tweets.
   */
  public async fetchAllQuotedTweets(
    tweetId: string,
    maxQuotes: number = 100,
  ): Promise<Tweet[]> {
    const allQuotes: Tweet[] = [];

    try {
      let cursor: string | undefined;
      let totalFetched = 0;

      while (totalFetched < maxQuotes) {
        const batchSize = Math.min(40, maxQuotes - totalFetched);
        const page = await this.fetchQuotedTweetsPage(
          tweetId,
          batchSize,
          cursor,
        );

        if (!page.tweets || page.tweets.length === 0) {
          break;
        }

        allQuotes.push(...page.tweets);
        totalFetched += page.tweets.length;

        // Check if there's a next page
        if (!page.next) {
          break;
        }

        cursor = page.next;
      }

      return allQuotes.slice(0, maxQuotes);
    } catch (error) {
      console.error("Error fetching quoted tweets:", error);
      throw error;
    }
  }

  /**
   * Fetches quoted tweets for a given tweet ID.
   * This method now uses a generator function internally but maintains backward compatibility.
   * @param tweetId The ID of the tweet to fetch quotes for.
   * @param maxQuotes Maximum number of quotes to return.
   * @param cursor Optional cursor for pagination.
   * @returns A promise that resolves to a QueryTweetsResponse containing tweets and the next cursor.
   */
  public async fetchQuotedTweetsPage(
    tweetId: string,
    maxQuotes: number = 40,
    cursor?: string,
  ): Promise<QueryTweetsResponse> {
    // For backward compatibility, collect quotes from the generator
    const quotes: Tweet[] = [];
    let count = 0;

    // searchQuotedTweets doesn't support cursor, so we'll collect all quotes up to maxQuotes
    for await (const quote of searchQuotedTweets(
      tweetId,
      maxQuotes,
      this.auth,
    )) {
      quotes.push(quote);
      count++;
      if (count >= maxQuotes) break;
    }

    return {
      tweets: quotes,
      next: undefined, // Twitter API v2 doesn't provide cursor for quote search
    };
  }
}
