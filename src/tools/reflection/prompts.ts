import {
  type ConversationState,
  type Message,
  type Paper,
  type State,
} from "../../types/core";
import { getMessagesByConversation } from "../../db/operations";
import { formatConversationHistory } from "../../utils/state";

const formatWebSearchResults = (results: any) => {
  if (!results) return "No search results";
  const resultsArray = Array.isArray(results) ? results : [results];
  const limitedResults = resultsArray.slice(0, 5);
  return JSON.stringify(limitedResults, null, 2);
};

const formatPapers = (papers: Paper[]) => {
  if (!papers || papers.length === 0) return "No papers";
  return papers
    .map(
      (paper, i) =>
        `${i + 1}. DOI: ${paper.doi || "N/A"}\n   Title: ${paper.title || "N/A"}\n   Abstract: ${paper.abstract || "N/A"}`,
    )
    .join("\n\n");
};

export async function getReflectionPrompt(
  state: State,
  conversationState: ConversationState,
  message: Message,
) {
  // Gather all papers from state
  const allPapersFromState = [
    ...(state.values.openScholarPapers || []),
    ...(state.values.semanticScholarPapers || []),
    ...(state.values.kgPapers || []),
    ...(state.values.finalPapers || []),
  ];

  // Fetch past 5 messages
  let conversationHistory: any[] = [];
  let historyText = "No previous messages";
  try {
    conversationHistory = await getMessagesByConversation(
      message.conversation_id,
      5,
    );
    // Reverse to get chronological order (oldest first)
    conversationHistory = conversationHistory.reverse();
    if (conversationHistory.length > 0) {
      historyText = formatConversationHistory(conversationHistory);
    }
  } catch (err) {
    console.error("Failed to fetch conversation history:", err);
  }

  return `
You are reflecting on a scientific research conversation to maintain accurate conversation state based on the latest message and the whole conversation.

## Latest Message State
**Question:** ${message.content}
**Hypothesis:** ${state.values.hypothesis || "No hypothesis formed"}
**Papers from this interaction:**
${formatPapers(allPapersFromState)}

## Conversation State (Whole Conversation Summary)
**Title:** ${conversationState.values.conversationTitle || "Not set"}
**Goal:** ${conversationState.values.conversationGoal || "Not set"}
**Methodology:** ${conversationState.values.methodology || "Not specified"}
**Hypothesis:** ${conversationState.values.hypothesis || "No working hypothesis"}
**Papers in conversation:**
${formatPapers(conversationState.values.papers ?? [])}
**Key Insights (limit 10):**
${(conversationState.values.keyInsights || []).map((insight, i) => `${i + 1}. ${insight}`).join("\n") || "No insights captured"}
**Past 5 messages:**
${historyText}

## Reflection Task
Update the Conversation State based on integrating the latest message with the whole conversation:

**conversationTitle**: A concise title (3-6 words) that captures the main topic of this conversation.

**conversationGoal**: Has the research goal evolved or become more specific?

**keyInsights**: Update to maximum 10 most important insights. Add new ones from latest message, merge related insights, remove outdated ones. Keep only the most valuable.

**methodology**: Current research approach if it has become clearer or changed.

**hypothesis**: Single working hypothesis that may have evolved from this interaction. Can be refined, replaced, or newly formed.

**papers**:
Remove papers that are:
- **Off-topic**: No longer relevant to current research focus
- **Superseded**: Covered by newer, more relevant papers
- **Tangential**: Only peripherally related to main research direction
- **Redundant**: Duplicate information with other retained papers
- **Outdated hypothesis**: Supporting a hypothesis that has been abandoned

### Principles
- Maintain exactly 10 or fewer key insights - prioritize quality over quantity
- One evolving hypothesis that represents current working theory
- Remove stale information aggressively
- Ensure all elements align with current research focus

Provide the updated Conversation State object in the following JSON format (do not include any other text or comments):
{
  "conversationTitle": "string",
  "conversationGoal": "string",
  "keyInsights": ["string"],
  "methodology": "string",
  "hypothesis": "string",
  "papers": [{"doi": "string", "title": "string", "abstract": "string"}]
}
`;
}
