import { TwitterApi } from "twitter-api-v2";
import { Profile } from "./profile";

/**
 * Twitter API v2 authentication using developer credentials
 */
export class TwitterAuth {
  private v2Client: TwitterApi | null = null;
  private authenticated = false;
  private profile?: Profile;

  constructor(
    private appKey: string,
    private appSecret: string,
    private accessToken: string,
    private accessSecret: string,
  ) {
    this.initializeClient();
  }

  private initializeClient(): void {
    this.v2Client = new TwitterApi({
      appKey: this.appKey,
      appSecret: this.appSecret,
      accessToken: this.accessToken,
      accessSecret: this.accessSecret,
    });
    this.authenticated = true;
  }

  /**
   * Get the Twitter API v2 client
   */
  getV2Client(): TwitterApi {
    if (!this.v2Client) {
      throw new Error("Twitter API client not initialized");
    }
    return this.v2Client;
  }

  /**
   * Check if authenticated
   */
  async isLoggedIn(): Promise<boolean> {
    if (!this.authenticated || !this.v2Client) {
      return false;
    }

    try {
      // Verify credentials by getting current user
      const me = await this.v2Client.v2.me();
      return !!me.data;
    } catch (error) {
      console.error("Failed to verify authentication:", error);
      return false;
    }
  }

  /**
   * Get current user profile
   */
  async me(): Promise<Profile | undefined> {
    if (this.profile) {
      return this.profile;
    }

    if (!this.v2Client) {
      throw new Error("Not authenticated");
    }

    try {
      const { data: user } = await this.v2Client.v2.me({
        "user.fields": [
          "id",
          "name",
          "username",
          "description",
          "profile_image_url",
          "public_metrics",
          "verified",
          "location",
          "created_at",
        ],
      });

      this.profile = {
        userId: user.id,
        username: user.username,
        name: user.name,
        biography: user.description,
        avatar: user.profile_image_url,
        followersCount: user.public_metrics?.followers_count,
        followingCount: user.public_metrics?.following_count,
        isVerified: user.verified,
        location: user.location || "",
        joined: user.created_at ? new Date(user.created_at) : undefined,
      };

      return this.profile;
    } catch (error) {
      console.error("Failed to get user profile:", error);
      return undefined;
    }
  }

  /**
   * Logout (clear credentials)
   */
  async logout(): Promise<void> {
    this.v2Client = null;
    this.authenticated = false;
    this.profile = undefined;
  }

  /**
   * For compatibility - always returns true since we use API keys
   */
  hasToken(): boolean {
    return this.authenticated;
  }
}
