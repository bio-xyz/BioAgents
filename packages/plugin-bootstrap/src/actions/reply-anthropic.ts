import {
  type Action,
  type ActionExample,
  composePromptFromState,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
} from '@elizaos/core';
import { Anthropic } from '@anthropic-ai/sdk';

/**
 * Template for generating dialog and actions for a character.
 *
 * @type {string}
 */
/**
 * Template for generating dialog and actions for a character.
 *
 * @type {string}
 */
const replyTemplate = `# Task: Generate dialog for the character {{agentName}}.
{{providers}}
# Instructions: Write the next message for {{agentName}}.
"thought" should be a short description of what the agent is thinking about and planning.
"message" should be the next message for {{agentName}} which they will send to the conversation.

Make sure to also incorporate the following analysis from your trusted science knowledge graph in the answer, if it exists and is relevant to the user's question:
{{finalSynthesis}}

And in every answer you MUST always make sure to just cite the list of ALL DOI identifiers cited exactly as following: "Citated papers: DOIs".

You have to cite all the following DOIs: {{paperDois}}

If you do not have access to the final synthesis, or paper DOIs, you CAN and you MUST skip the analysis and citations - it is CRUCIAL you do not hallucinate or make up information.

Remember, you are an AI Agent representing Aubrey De Grey, so you have to act like him, and you have to be very careful regarding the information you provide - you cannot hallucinate or make up information, base all your answers on the provided information.

Response format should be formatted in a valid JSON block like this:
\`\`\`json
{
    "thought": "<string>",
    "message": "<messageString> Citated papers: All DOIs"
}
\`\`\`

Your response should include the valid JSON block and nothing else.`;

/**
 * Represents an action that allows the agent to reply to the current conversation with a generated message.
 *
 * This action can be used as an acknowledgement at the beginning of a chain of actions, or as a final response at the end of a chain of actions.
 *
 * @typedef {Object} replyAction
 * @property {string} name - The name of the action ("REPLY").
 * @property {string[]} similes - An array of similes for the action.
 * @property {string} description - A description of the action and its usage.
 * @property {Function} validate - An asynchronous function for validating the action runtime.
 * @property {Function} handler - An asynchronous function for handling the action logic.
 * @property {ActionExample[][]} examples - An array of example scenarios for the action.
 */
export const replyAction = {
  name: 'REPLY',
  similes: ['GREET', 'REPLY_TO_MESSAGE', 'SEND_REPLY', 'RESPOND', 'RESPONSE'],
  description:
    'Replies to the current conversation with the text from the generated message. Default if the agent is responding with a message and no other action. Use REPLY at the beginning of a chain of actions as an acknowledgement, and at the end of a chain of actions as a final response.',
  validate: async (_runtime: IAgentRuntime) => {
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
    responses?: Memory[]
  ) => {
    // Check if any responses had providers associated with them
    const allProviders = responses?.flatMap((res) => res.content?.providers ?? []) ?? [];

    // Only generate response using LLM if no suitable response was found
    state = await runtime.composeState(message, [...(allProviders ?? []), 'RECENT_MESSAGES']);

    const prompt = composePromptFromState({
      state,
      template: replyTemplate,
    });

    const anthropic = new Anthropic({
      apiKey: runtime.getSetting('ANTHROPIC_API_KEY'),
    });

    const response = await anthropic.messages.create({
      model: runtime.getSetting('ANTHROPIC_LARGE_MODEL'),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const textAndThoughts = JSON.parse(
      textBlock?.text.replace(/```json\n/, '').replace(/\n```/, '') as string
    );

    const responseContent = {
      thought: textAndThoughts.thought || '',
      text: textAndThoughts.message || '',
      actions: ['REPLY'],
      papers: state.values.finalPapers,
    };

    await callback(responseContent);

    return true;
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Hello there!',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Hi! How can I help you today?',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "What's your favorite color?",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I really like deep shades of blue. They remind me of the ocean and the night sky.',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you explain how neural networks work?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Let me break that down for you in simple terms...',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Could you help me solve this math problem?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "Of course! Let's work through it step by step.",
          actions: ['REPLY'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;
