import type { IAgentRuntime, Memory, Provider, UUID } from '@elizaos/core';
import { addHeader, MESSAGE_STATE } from '@elizaos/core';
import { KnowledgeService } from './service.ts';

const KNOWLEDGE_CHUNKS_PER_ANSWER = 10;

/**
 * Represents a knowledge provider that retrieves knowledge from the knowledge base.
 * @type {Provider}
 * @property {string} name - The name of the knowledge provider.
 * @property {string} description - The description of the knowledge provider.
 * @property {boolean} dynamic - Indicates if the knowledge provider is dynamic or static.
 * @property {Function} get - Asynchronously retrieves knowledge from the knowledge base.
 * @param {IAgentRuntime} runtime - The agent runtime object.
 * @param {Memory} message - The message containing the query for knowledge retrieval.
 * @returns {Object} An object containing the retrieved knowledge data, values, and text.
 */
export const knowledgeProvider: Provider = {
  name: 'KNOWLEDGE',
  description:
    'Knowledge from the knowledge base that the agent knows, retrieved whenever the agent needs to answer a question about their expertise.',
  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory) => {
    const room = await runtime.getRoom(message.roomId);
    // Broadcast KNOWLEDGE state when this provider starts executing
    await runtime.broadcastMessageState(
      room?.channelId as UUID,
      MESSAGE_STATE.KNOWLEDGE,
      message.id
    );

    const senderId = (message.metadata as any)?.raw?.senderId;
    const useInternalKnowledge = (await runtime.hasInternalKnowledge(senderId)) || false;
    console.log(
      'Using internal knowledge in knowledge plugin provider:',
      useInternalKnowledge,
      senderId
    );

    const knowledgeService = runtime.getService('knowledge') as KnowledgeService;
    const knowledgeData = await knowledgeService?.getKnowledge(message, {
      chunksDbName: 'knowledge',
    });

    let knowledgeItems;

    const setting = runtime.getSetting('KNOWLEDGE_CHUNKS_PER_ANSWER');
    const knowledgeChunksPerAnswer =
      setting != null ? Number(setting) : KNOWLEDGE_CHUNKS_PER_ANSWER;

    if (useInternalKnowledge) {
      const userKnowledgeData = await knowledgeService?.getKnowledge(message, {
        chunksDbName: senderId,
        // use wallet as dbName
      });
      console.log(
        'Got user knowledge data result length from user DB:',
        userKnowledgeData.length,
        senderId
      );
      if (userKnowledgeData.length) {
        const userChunks = Math.min(
          Math.floor(knowledgeChunksPerAnswer * 0.3),
          userKnowledgeData.length
        );
        const generalChunks = knowledgeChunksPerAnswer - userChunks;
        knowledgeItems = [
          ...knowledgeData.slice(0, generalChunks),
          ...userKnowledgeData.slice(0, userChunks),
        ];
      } else {
        knowledgeItems = knowledgeData?.slice(0, knowledgeChunksPerAnswer);
      }
    } else {
      knowledgeItems = knowledgeData?.slice(0, knowledgeChunksPerAnswer);
    }

    let knowledge =
      (knowledgeItems && knowledgeItems.length > 0
        ? addHeader(
            '# Knowledge',
            knowledgeItems.map((knowledge) => `- ${knowledge.content.text}`).join('\n')
          )
        : '') + '\n';

    const tokenLength = 3.5;

    if (knowledge.length > 4000 * tokenLength) {
      knowledge = knowledge.slice(0, 4000 * tokenLength);
    }

    // 📊 Prepare RAG metadata for conversation memory tracking
    let ragMetadata = null;
    if (knowledgeData && knowledgeData.length > 0) {
      ragMetadata = {
        retrievedFragments: knowledgeData.map((fragment) => ({
          fragmentId: fragment.id,
          documentTitle:
            (fragment.metadata as any)?.filename ||
            (fragment.metadata as any)?.title ||
            'Unknown Document',
          similarityScore: (fragment as any).similarity,
          contentPreview: (fragment.content?.text || 'No content').substring(0, 100) + '...',
        })),
        queryText: message.content?.text || 'Unknown query',
        totalFragments: knowledgeData.length,
        retrievalTimestamp: Date.now(),
      };
    }

    // 🎯 Store RAG metadata for conversation memory enrichment
    if (knowledgeData && knowledgeData.length > 0 && knowledgeService && ragMetadata) {
      try {
        knowledgeService.setPendingRAGMetadata(ragMetadata);

        // Schedule enrichment check (with small delay to allow memory creation)
        setTimeout(async () => {
          try {
            await knowledgeService.enrichRecentMemoriesWithPendingRAG();
          } catch (error: any) {
            console.warn('RAG memory enrichment failed:', error.message);
          }
        }, 2000); // 2 second delay
      } catch (error: any) {
        // Don't fail the provider if enrichment fails
        console.warn('RAG memory enrichment failed:', error.message);
      }
    }

    if (knowledgeItems && knowledgeItems.length > 0) {
      await runtime.updateAnswerEval(message.id as string, {
        knowledgeChunks: knowledgeItems.map((item) => item.content.text),
      });
    }

    return {
      data: {
        knowledge,
        ragMetadata, // 🎯 Include RAG metadata for memory tracking
        knowledgeUsed: knowledgeData && knowledgeData.length > 0, // Simple flag for easy detection
      },
      values: {
        knowledge,
        knowledgeUsed: knowledgeData && knowledgeData.length > 0, // Simple flag for easy detection
      },
      text: knowledge,
      ragMetadata, // 🎯 Also include at top level for easy access
      knowledgeUsed: knowledgeData && knowledgeData.length > 0, // 🎯 Simple flag at top level too
    };
  },
};
