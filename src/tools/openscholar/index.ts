import axios from "axios";
import character from "../../character";
import { getMessagesByConversation, updateMessage } from "../../db/operations";
import { LLM } from "../../llm/provider";
import { type Message, type State } from "../../types/core";
import { REFORMULATE_QUESTION_LONGEVITY_PROMPT } from "../../utils/longevity";
import {
  addVariablesToState,
  formatConversationHistory,
} from "../../utils/state";

interface OpenScholarChunk {
  reranker_score: number;
  paper_id: string;
  chunk_id: string;
  text: string;
  title: string;
  // TODO: abstract?: string;
}

async function fetchOpenScholarChunks(
  question: string,
  finalTopk: number = 10,
): Promise<OpenScholarChunk[]> {
  const endpoint = process.env.OPENSCHOLAR_API_URL || "";

  // Minimal request per your Swagger: include per_paper_cap and final_topk
  const body = {
    query: question,
    initial_topk: 400,
    keep_for_rerank: 80,
    final_topk: finalTopk,
    per_paper_cap: 3,
    boost_mode: "mul",
    boost_lambda: 0.1,
    max_length: 512,
  };

  const res = await axios.post(endpoint, body, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.OPENSCHOLAR_API_KEY,
    },
  });

  if (res.status !== 200) {
    throw new Error(`OpenScholar API error ${res.status}: ${res.data}`);
  }

  const json = res.data as {
    query: string;
    results_count: number;
    processing_time: number;
    results: OpenScholarChunk[];
  };

  const chunks = Array.isArray(json.results)
    ? json.results.filter((chunk) => chunk.reranker_score > 0)
    : [];

  return chunks;
}

async function getReformulatedHallmarkQuestion(
  question: string,
): Promise<string> {
  const reformulationPrompt = `${REFORMULATE_QUESTION_LONGEVITY_PROMPT}\n\nQuestion: ${question}`;
  const llmProvider = new LLM({
    name: "openai",
    apiKey: process.env.OPENAI_API_KEY!,
  });

  const llmRequest = {
    model: "gpt-5",
    messages: [
      {
        role: "user" as const,
        content: reformulationPrompt,
      },
    ],
    maxTokens: 100,
  };

  const llmResponse = await llmProvider.createChatCompletion(llmRequest);

  return llmResponse.content;
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

export const openscholarTool = {
  name: "OPENSCHOLAR",
  description:
    "OpenScholar plugin that retrieves, reranks the most relevant passages from thousands of scientific papers to generate citation grounded answers to research queries.",
  execute: async (input: { state: State; message: Message }) => {
    const { state, message } = input;

    const cacheKey = `openscholar:data:${message.question}:${message.conversation_id}`;

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

    // TODO: implement actual cache for openscholar results
    const cachedResult = null;

    if (cachedResult) {
      return cachedResult;
    }

    const topChunks = await fetchOpenScholarChunks(question);

    const reformulatedHallmarkQuestion =
      await getReformulatedHallmarkQuestion(question);

    const hallmarkChunks = reformulatedHallmarkQuestion?.length
      ? await fetchOpenScholarChunks(reformulatedHallmarkQuestion, 3)
      : [];

    const seen = new Set(topChunks.map((c: OpenScholarChunk) => c.chunk_id));
    const allChunks = [
      ...topChunks,
      ...hallmarkChunks.filter(
        (c) => !seen.has(c.chunk_id) && seen.add(c.chunk_id),
      ),
    ];

    const openScholarPapers = allChunks.map((chunk) => ({
      title: chunk.title,
      doi: `https://doi.org/${chunk.paper_id}`,
    }));
    const openScholarRaw = allChunks.map((chunk) => ({
      title: chunk.title,
      doi: `https://doi.org/${chunk.paper_id}`,
      chunkText: chunk.text,
    }));
    const openScholarPaperDois = openScholarPapers.map((p) => p.doi);

    // TODO: shortened papers for Twitter
    const shortenedPapers: string[] = [];

    // TODO: logger.info openscholar dois

    addVariablesToState(state, {
      openScholarPapers,
      openScholarRaw,
      openScholarPaperDois,
      // shortenedPapers,
    });

    // TODO: return result
    const result = {
      text: "OpenScholar papers",
      values: {
        openScholarRaw,
        openScholarSynthesis: allChunks
          .map((chunk) => `${chunk.paper_id}: ${chunk.text}`)
          .join("\n\n"),
        openScholarPapers,
        openScholarPaperDois,
        openScholarShortenedPapers: shortenedPapers,
      },
    };

    // TODO: add result to cache

    // Update message in DB with current state
    if (message.id) {
      try {
        await updateMessage(message.id, {
          state: state.values,
        });
      } catch (err) {
        // Log error but don't fail the tool execution
        console.error("Failed to update message in DB:", err);
      }
    }

    return result;
  },
};
