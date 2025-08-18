/**
 * Knowledge Plugin - Main Entry Point
 *
 * This file exports all the necessary functions and types for the Knowledge plugin.
 */
import type { Plugin, IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { validateModelConfig } from './config';
import { KnowledgeService } from './service';
import { knowledgeProvider } from './provider';
import knowledgeTestSuite from './tests';
import { knowledgeActions } from './actions';
import { knowledgeRoutes } from './routes';

/**
 * Knowledge Plugin - Provides Retrieval Augmented Generation capabilities
 */
export const knowledgePlugin: Plugin = {
  name: 'knowledge',
  description:
    'Plugin for Retrieval Augmented Generation, including knowledge management and embedding.',
  config: {
    // Token limits - these will be read from runtime settings during init
    MAX_INPUT_TOKENS: '4000',
    MAX_OUTPUT_TOKENS: '4096',

    // Contextual Knowledge settings
    CTX_KNOWLEDGE_ENABLED: 'false',
  },
  async init(config: Record<string, string>, runtime?: IAgentRuntime) {
    logger.info('Initializing Knowledge Plugin...');
    try {
      // Validate the model configuration
      logger.info('Validating model configuration for Knowledge plugin...');
      
      // CRITICAL FIX: During plugin init, runtime might not be fully available
      // So we need to check environment variables directly as a fallback
      logger.info(`[Knowledge Plugin] INIT DEBUG:`);
      logger.info(`[Knowledge Plugin] - Runtime available: ${!!runtime}`);
      logger.info(`[Knowledge Plugin] - process.env.CTX_KNOWLEDGE_ENABLED: '${process.env.CTX_KNOWLEDGE_ENABLED}'`);
      logger.info(`[Knowledge Plugin] - config.CTX_KNOWLEDGE_ENABLED: '${config.CTX_KNOWLEDGE_ENABLED}'`);
      if (runtime) {
        logger.info(`[Knowledge Plugin] - runtime.getSetting('CTX_KNOWLEDGE_ENABLED'): '${runtime.getSetting('CTX_KNOWLEDGE_ENABLED')}'`);
      }
      
      const validatedConfig = validateModelConfig(runtime);

      // CRITICAL: Check CTX_KNOWLEDGE_ENABLED from multiple sources during init
      const ctxEnabledFromEnv = process.env.CTX_KNOWLEDGE_ENABLED === 'true' || process.env.CTX_KNOWLEDGE_ENABLED === 'True';
      const ctxEnabledFromConfig = config.CTX_KNOWLEDGE_ENABLED === 'true' || config.CTX_KNOWLEDGE_ENABLED === 'True';
      const ctxEnabledFromValidated = validatedConfig.CTX_KNOWLEDGE_ENABLED;
      const ctxEnabledFromRuntime = runtime ? (runtime.getSetting('CTX_KNOWLEDGE_ENABLED') === 'true' || runtime.getSetting('CTX_KNOWLEDGE_ENABLED') === 'True') : false;
      
      // Use the most permissive check during initialization
      const finalCtxEnabled = ctxEnabledFromEnv || ctxEnabledFromConfig || ctxEnabledFromValidated || ctxEnabledFromRuntime;
      
      logger.info(`[Knowledge Plugin] CTX_KNOWLEDGE_ENABLED sources:`);
      logger.info(`[Knowledge Plugin] - From env: ${ctxEnabledFromEnv}`);
      logger.info(`[Knowledge Plugin] - From config: ${ctxEnabledFromConfig}`);
      logger.info(`[Knowledge Plugin] - From validated: ${ctxEnabledFromValidated}`);
      logger.info(`[Knowledge Plugin] - From runtime: ${ctxEnabledFromRuntime}`);
      logger.info(`[Knowledge Plugin] - FINAL RESULT: ${finalCtxEnabled}`);
      
      // Log the operational mode
      if (finalCtxEnabled) {
        logger.info('🚀 Running in Contextual Knowledge mode with text generation capabilities.');
        logger.info(
          `🔧 Using ${validatedConfig.EMBEDDING_PROVIDER || 'auto-detected'} for embeddings and ${validatedConfig.TEXT_PROVIDER || process.env.TEXT_PROVIDER} for text generation.`
        );
        logger.info(`🤖 Text model: ${validatedConfig.TEXT_MODEL || process.env.TEXT_MODEL}`);
      } else {
        const usingPluginOpenAI = !process.env.EMBEDDING_PROVIDER;

        logger.warn('⚠️  Running in Basic Embedding mode - documents will NOT be enriched with context!');
        logger.info('💡 To enable contextual enrichment:');
        logger.info('   - Set CTX_KNOWLEDGE_ENABLED=true');
        logger.info('   - Configure TEXT_PROVIDER (anthropic/openai/openrouter/google)');
        logger.info('   - Configure TEXT_MODEL and API key');
        
        if (usingPluginOpenAI) {
          logger.info('🔧 Using auto-detected configuration from plugin-openai for embeddings.');
        } else {
          logger.info(
            `🔧 Using ${validatedConfig.EMBEDDING_PROVIDER} for embeddings with ${validatedConfig.TEXT_EMBEDDING_MODEL}.`
          );
        }
      }

      logger.info('Model configuration validated successfully.');

      if (runtime) {
        logger.info(`Knowledge Plugin initialized for agent: ${runtime.agentId}`);

        // Check if docs should be loaded on startup (only when explicitly enabled)
        const loadDocsOnStartup =
          config.LOAD_DOCS_ON_STARTUP === 'true' || process.env.LOAD_DOCS_ON_STARTUP === 'true';

        if (loadDocsOnStartup) {
          logger.info('LOAD_DOCS_ON_STARTUP is enabled. Scheduling document loading...');
          // Schedule document loading after service initialization
          setTimeout(async () => {
            try {
              const service = runtime.getService(KnowledgeService.serviceType);
              if (service instanceof KnowledgeService) {
                const { loadDocsFromPath } = await import('./docs-loader');
                const result = await loadDocsFromPath(service, runtime.agentId);
                if (result.successful > 0) {
                  logger.info(`Loaded ${result.successful} documents from docs folder on startup`);
                }
              }
            } catch (error) {
              logger.error('Error loading documents on startup:', error);
            }
          }, 5000); // Delay to ensure services are fully initialized
        } else {
          logger.info('LOAD_DOCS_ON_STARTUP is not enabled. Skipping automatic document loading.');
        }
      }

      logger.info(
        'Knowledge Plugin initialized. Frontend panel should be discoverable via its public route.'
      );
    } catch (error) {
      logger.error('Failed to initialize Knowledge plugin:', error);
      throw error;
    }
  },
  services: [KnowledgeService],
  providers: [knowledgeProvider],
  routes: knowledgeRoutes,
  actions: knowledgeActions,
  tests: [knowledgeTestSuite],
};

export default knowledgePlugin;

export * from './types';
