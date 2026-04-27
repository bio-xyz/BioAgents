import type { StateValues } from "../types/core";
import type { SourceSelectionId } from "../types/sourceSelection";

type MessageStateSeed = {
  conversation_id: string;
  id?: string | null;
  source?: string | null;
  source_selection_id?: SourceSelectionId | null;
  user_id: string;
};

export function buildMessageStateValues(input: {
  baseValues?: Partial<StateValues>;
  message: MessageStateSeed;
  isDeepResearch?: boolean;
}): StateValues {
  const { baseValues = {}, message, isDeepResearch = false } = input;

  const values: StateValues = {
    ...baseValues,
  };

  if (message.conversation_id) {
    values.conversationId = message.conversation_id;
  }

  if (message.id) {
    values.messageId = message.id;
  }

  if (message.source) {
    values.source = message.source;
  }

  if (message.source_selection_id) {
    values.sourceSelectionId = message.source_selection_id;
  }

  if (message.user_id) {
    values.userId = message.user_id;
  }

  if (isDeepResearch) {
    values.isDeepResearch = true;
  }

  return values;
}
