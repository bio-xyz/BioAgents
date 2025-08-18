import { type IAgentRuntime, logger, type Plugin } from '@elizaos/core';
import { TwitterService } from './services/twitter.service.js';

export const TwitterPlugin: Plugin = {
  name: 'twitter',
  description: 'Twitter client with posting, interactions, and timeline actions',
  actions: [],
  services: [TwitterService],
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    // Only do validation in init, don't start services
    logger.log('🔧 Initializing Twitter plugin...');

    // Check if we can access settings
    const hasGetSetting = runtime && typeof runtime.getSetting === 'function';

    // Basic validation of required settings
    const apiKey = hasGetSetting
      ? runtime.getSetting('TWITTER_API_KEY')
      : process.env.TWITTER_API_KEY;
    const apiSecretKey = hasGetSetting
      ? runtime.getSetting('TWITTER_API_SECRET_KEY')
      : process.env.TWITTER_API_SECRET_KEY;
    const accessToken = hasGetSetting
      ? runtime.getSetting('TWITTER_ACCESS_TOKEN')
      : process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = hasGetSetting
      ? runtime.getSetting('TWITTER_ACCESS_TOKEN_SECRET')
      : process.env.TWITTER_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiSecretKey || !accessToken || !accessTokenSecret) {
      const missing = [];
      if (!apiKey) missing.push('TWITTER_API_KEY');
      if (!apiSecretKey) missing.push('TWITTER_API_SECRET_KEY');
      if (!accessToken) missing.push('TWITTER_ACCESS_TOKEN');
      if (!accessTokenSecret) missing.push('TWITTER_ACCESS_TOKEN_SECRET');

      logger.warn(
        `Twitter API credentials not configured - Twitter functionality will be limited. Missing: ${missing.join(', ')}`
      );
      logger.warn(
        'To enable Twitter functionality, please provide the missing credentials in your .env file'
      );
    } else {
      logger.log('✅ Twitter credentials found');
    }
  },
};

export default TwitterPlugin;
