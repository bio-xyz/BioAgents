import fs from 'node:fs';
import path from 'node:path';
import { type Character } from '@elizaos/core';

// Fixed avatar path for all agents
const imagePath = path.resolve('./assets/portrait.jpg');

const avatar = fs.existsSync(imagePath)
  ? `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}`
  : '';

interface CharacterConfig {
  name: string;
  plugins: string[];
  settings?: {
    discord?: {
      shouldIgnoreDirectMessages?: boolean;
      shouldRespondOnlyToMentions?: boolean;
    };
  };
  system: string;
  templates: {
    replyTemplate: string;
    messageHandlerTemplate: string;
  };
  bio: string[];
  topics: string[];
  messageExamples: any[];
  style: {
    all: string[];
    chat: string[];
  };
}

function buildSecrets() {
  return {
    DISCORD_APPLICATION_ID: process.env.AGENT_DISCORD_APPLICATION_ID,
    DISCORD_API_TOKEN: process.env.AGENT_DISCORD_API_TOKEN,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: 'GxI4uGcGJGQfrRsN19Ic',
    DISCORD_GUILD_ID: process.env.AGENT_DISCORD_GUILD_ID,
    DISCORD_VOICE_CHANNEL_ID: process.env.AGENT_DISCORD_VOICE_CHANNEL_ID,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASEURL:
      process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  };
}

async function loadCharacterFromGist(): Promise<Character> {
  const configUrl = process.env.AGENT_CONFIG_URL;

  if (!configUrl) {
    throw Error('Please set up your AGENT_CONFIG_URL.');
  }

  try {
    console.log('Fetching remote agent config URL...');

    const response = await fetch(configUrl);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    // @ts-ignore
    const config: CharacterConfig = await response.json();

    // Build the complete character object
    const character: Character = {
      name: config.name,
      plugins: config.plugins,
      settings: {
        secrets: buildSecrets(),
        discord: config.settings?.discord || {
          shouldIgnoreDirectMessages: true,
          shouldRespondOnlyToMentions: true,
        },
        avatar, // Use the pre-loaded avatar
      },
      topics: config.topics,
      system: config.system,
      templates: config.templates,
      bio: config.bio,
      messageExamples: config.messageExamples,
      style: config.style,
    };

    return character;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load character config from ${configUrl}: ${errorMsg}`);
    throw new Error(`Failed to load character config: ${errorMsg}`);
  }
}

// Export the character as a promise that resolves when loaded
export const character = await loadCharacterFromGist();
