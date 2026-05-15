import type { ConversationStateValues, DataArtifact } from "../types/core";

export const NORMAL_CHAT_ARTIFACTS_KEY = "normalChatArtifactsByMessageId";

function artifactKey(artifact: DataArtifact): string {
  return artifact.id || artifact.path || artifact.url || artifact.name;
}

export function mergeArtifacts(...groups: Array<DataArtifact[] | undefined>): DataArtifact[] {
  const merged: DataArtifact[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const artifact of group || []) {
      const key = artifactKey(artifact);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(artifact);
    }
  }

  return merged;
}

export function withNormalChatArtifacts(
  values: ConversationStateValues,
  messageId: string,
  artifacts?: DataArtifact[]
): ConversationStateValues {
  if (!artifacts?.length) {
    return values;
  }

  const existingMap = values.normalChatArtifactsByMessageId || {};
  const existingArtifacts = existingMap[messageId];

  return {
    ...values,
    [NORMAL_CHAT_ARTIFACTS_KEY]: {
      ...existingMap,
      [messageId]: mergeArtifacts(existingArtifacts, artifacts),
    },
  };
}
