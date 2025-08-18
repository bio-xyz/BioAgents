import dotenv from 'dotenv';
import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import { character } from './character';

dotenv.config({ path: '../../.env' });

const initCharacter = async ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing Agent character');
  logger.info('Name: ', character.name);
};

export const scientificAgent: ProjectAgent = {
  character,
  plugins: [],
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
};

const project: Project = {
  agents: [scientificAgent],
};

// Export character for use in other files
export { character } from './character';

export default project;
