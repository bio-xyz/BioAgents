import { describe, expect, test } from "bun:test";
import {
  applySourceSelectionPlanningOverrides,
  extractExplicitProteinSequence,
  resolveSourceSelectionLiteratureOverride,
} from "../sourceSelectionRouting";

describe("sourceSelectionRouting", () => {
  test("extracts explicit protein sequence from a labeled sequence string", () => {
    const message =
      "Please search AlphaFold. Protein sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";

    expect(extractExplicitProteinSequence(message)).toBe(
      "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP"
    );
  });

  test("rewrites AlphaFold planning to a single sequence-only literature task", () => {
    const sequence = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";
    const plan = applySourceSelectionPlanningOverrides({
      plan: [
        {
          datasets: [],
          objective: "Find AlphaFold structure information for this protein",
          type: "LITERATURE",
        },
        {
          datasets: [],
          objective: "Run follow-up analysis",
          type: "ANALYSIS",
        },
      ],
      sourceSelectionId: "alphafold_db",
      userMessage: `Sequence: ${sequence}`,
    });

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      datasets: [],
      objective: sequence,
      sources: ["alphafold_db"],
      type: "LITERATURE",
    });
  });

  test("does not force AlphaFold routing without an explicit sequence", () => {
    const originalPlan = [
      {
        datasets: [],
        objective: "Find AlphaFold structure information for TP53",
        type: "LITERATURE" as const,
      },
    ];

    const plan = applySourceSelectionPlanningOverrides({
      plan: originalPlan,
      sourceSelectionId: "alphafold_db",
      userMessage: "Find AlphaFold entries for TP53",
    });

    expect(plan).toEqual(originalPlan);
  });

  test("does not treat short identifiers as explicit protein sequences", () => {
    expect(extractExplicitProteinSequence("protein sequence: TP53")).toBeUndefined();
    expect(extractExplicitProteinSequence("AA sequence: MAPK")).toBeUndefined();
  });

  test("runtime literature override rewrites AlphaFold queries to sequence-only biolit sources", () => {
    const sequence = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";

    expect(
      resolveSourceSelectionLiteratureOverride({
        objective: "Find AlphaFold structure information for this protein",
        sourceSelectionId: "alphafold_db",
        userMessage: `Protein sequence: ${sequence}`,
      })
    ).toEqual({
      objective: sequence,
      sources: ["alphafold_db"],
    });
  });

  test("runtime literature override leaves non-sequence AlphaFold requests unchanged", () => {
    expect(
      resolveSourceSelectionLiteratureOverride({
        objective: "Find AlphaFold structure information for TP53",
        sourceSelectionId: "alphafold_db",
        userMessage: "Find AlphaFold structure information for TP53",
      })
    ).toEqual({
      objective: "Find AlphaFold structure information for TP53",
    });
  });
});
