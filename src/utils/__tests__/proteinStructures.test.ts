import { describe, expect, jest, test } from "bun:test";
import type { ConversationStateValues } from "../../types/core";
import logger from "../logger";
import {
  extractProteinStructuresFromBioLiteratureResponse,
  NORMAL_CHAT_PROTEIN_STRUCTURES_KEY,
  withNormalChatProteinStructures,
} from "../proteinStructures";

describe("withNormalChatProteinStructures", () => {
  test("stores normal chat structures under the reload-compatible message map", () => {
    const values = {
      objective: "find structures",
    } as ConversationStateValues;

    const nextValues = withNormalChatProteinStructures(values, "msg-1", [
      {
        bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.bcif",
        entryId: "AF-P04637-F1",
      },
    ]);

    expect(nextValues[NORMAL_CHAT_PROTEIN_STRUCTURES_KEY]?.["msg-1"]).toEqual([
      {
        bcifUrl: "https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.bcif",
        entryId: "AF-P04637-F1",
      },
    ]);
  });

  test("merges structures without duplicating an existing message entry", () => {
    const values = {
      normalChatProteinStructuresByMessageId: {
        "msg-1": [{ entryId: "AF-P04637-F1" }],
      },
      objective: "find structures",
    } as ConversationStateValues;

    const nextValues = withNormalChatProteinStructures(values, "msg-1", [
      { entryId: "AF-P04637-F1" },
      { entryId: "AF-Q8W3K0-F1" },
    ]);

    expect(nextValues.normalChatProteinStructuresByMessageId?.["msg-1"]).toEqual([
      { entryId: "AF-P04637-F1" },
      { entryId: "AF-Q8W3K0-F1" },
    ]);
  });
});

describe("extractProteinStructuresFromBioLiteratureResponse", () => {
  test("warns when all AlphaFold candidates are dropped during normalization", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);

    try {
      const structures = extractProteinStructuresFromBioLiteratureResponse({
        response: {
          tool_results: {
            search_alphafold: {
              results: [
                {
                  id: "AF-P04637-F1",
                  metadata: {
                    entryId: "AF-P04637-F1",
                    entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-P04637-F1",
                  },
                  source: "alphafold_db",
                  title: "TP53",
                  url: "https://alphafold.ebi.ac.uk/entry/AF-P04637-F1",
                },
              ],
            },
          },
        },
      });

      expect(structures).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          droppedCount: 1,
          totalCandidates: 1,
        }),
        "alphafold_protein_structure_candidates_dropped"
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
