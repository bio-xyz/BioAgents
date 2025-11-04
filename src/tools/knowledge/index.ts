import {
  getMessagesByConversation,
  updateState,
} from "../../db/operations";
import { VectorSearchWithDocuments } from "../../embeddings/vectorSearchWithDocs";
import { type Message, type State } from "../../types/core";
import logger from "../../utils/logger";
import {
  addVariablesToState,
  getStandaloneMessage,
  startStep,
  endStep,
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

export const knowledgeTool = {
  name: "KNOWLEDGE",
  description:
    "Knowledge base RAG plugin that retrieves the most relevant chunks from the vector database to answer user queries.",
  enabled: true,
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;

    startStep(state, "KNOWLEDGE");

    // Update state in DB after startStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error("Failed to update state in DB:", err as any);
      }
    }

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

    endStep(state, "KNOWLEDGE");

    // Update state in DB after endStep
    if (state.id) {
      try {
        await updateState(state.id, state.values);
      } catch (err) {
        logger.error("Failed to update state in DB:", err as any);
      }
    }

    return result;
  },
};
