import character from "../../character";
import { getMessagesByConversation, updateMessage } from "../../db/operations";
import { VectorSearchWithDocuments } from "../../embeddings/vectorSearchWithDocs";
import { LLM } from "../../llm/provider";
import { type Message, type State } from "../../types/core";
import logger from "../../utils/logger";
import {
  addVariablesToState,
  formatConversationHistory,
} from "../../utils/state";

// Initialize vector search with documents
const vectorSearch = new VectorSearchWithDocuments();

// Load documents on startup if KNOWLEDGE_DOCS_PATH is set
const docsPath = process.env.KNOWLEDGE_DOCS_PATH;
if (docsPath) {
  logger.info(`Loading knowledge base documents from: ${docsPath}`);
  await vectorSearch.loadDocsOnStartup(docsPath);
} else {
  logger.warn("KNOWLEDGE_DOCS_PATH not set, skipping document loading");
}

async function getStandaloneMessage(
  thread: any[],
  latestMessage: string,
): Promise<string> {
  // If thread is empty or only has 1 message, return the message as-is
  if (thread.length <= 1) {
    return latestMessage;
  }

  // Format conversation history (exclude the last message as it's passed separately)
  // Each DB message contains both user question and assistant response
  const conversationHistory = formatConversationHistory(thread.slice(0, -1));

  const prompt = character.templates.standaloneMessageTemplate
    .replace("{conversationHistory}", conversationHistory)
    .replace("{latestMessage}", latestMessage);

  const llmProvider = new LLM({
    name: "google",
    apiKey: process.env.GOOGLE_API_KEY!,
  });

  const llmRequest = {
    model: "gemini-2.5-pro",
    messages: [
      {
        role: "user" as const,
        content: prompt,
      },
    ],
    maxTokens: 150,
  };

  const llmResponse = await llmProvider.createChatCompletion(llmRequest);

  return llmResponse.content.trim();
}

export const knowledgeTool = {
  name: "KNOWLEDGE",
  description:
    "Knowledge base RAG plugin that retrieves the most relevant chunks from the vector database to answer user queries.",
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;

    // Get conversation thread (last 3 DB messages = 6 actual messages)
    const allMessages = await getMessagesByConversation(
      message.conversation_id,
      3,
    );
    // Reverse to get chronological order (oldest first)
    const thread = allMessages.reverse();

    // Generate standalone message based on thread
    const standaloneMessage = await getStandaloneMessage(
      thread,
      message.question || "",
    );
    const question = standaloneMessage;

    logger.info(`🔍 Searching knowledge base for: "${question}"`);

    // Search for relevant documents (uses internal cache)
    const searchResults = await vectorSearch.search(question);

    logger.info(` Found ${searchResults.length} relevant knowledge chunks`);

    // Format chunks for state
    const knowledgeChunks = searchResults.map((doc) => ({
      title: doc.title,
      content: doc.content,
    }));

    addVariablesToState(state, {
      knowledge: knowledgeChunks,
    });

    const result = {
      text: "Knowledge base chunks",
      values: {
        knowledge: knowledgeChunks,
      },
    };

    // Update message in DB with current state
    if (message.id) {
      try {
        await updateMessage(message.id, {
          state: state.values,
        });
      } catch (err) {
        logger.error("Failed to update message in DB:", err as any);
      }
    }

    return result;
  },
};
