import { describe, expect, test } from "bun:test";
import {
  applySourceSelectionPlanningOverrides,
  applySourceSelectionToPromotedTasks,
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

  test("rejects prose after a labeled AlphaFold sequence", () => {
    const message =
      "Sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP please search AlphaFold";

    expect(extractExplicitProteinSequence(message)).toBeUndefined();
  });

  test("rejects decorated or invalid AlphaFold sequence candidates", () => {
    expect(
      extractExplicitProteinSequence(
        "Sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP*"
      )
    ).toBeUndefined();
    expect(
      extractExplicitProteinSequence(
        "Sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP!"
      )
    ).toBeUndefined();
    expect(
      extractExplicitProteinSequence(
        "Sequence: MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP1"
      )
    ).toBeUndefined();
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

  test("does not treat bare DNA-only sequence labels as explicit protein sequences", () => {
    const dnaRepeat = "ACGTACGTACGTACGTACGTACGTACGTACGT";

    expect(extractExplicitProteinSequence(`Sequence: ${dnaRepeat}`)).toBeUndefined();
    expect(
      resolveSourceSelectionLiteratureOverride({
        objective: "Find AlphaFold structure information for this sequence",
        sourceSelectionId: "alphafold_db",
        userMessage: `Sequence: ${dnaRepeat}`,
      })
    ).toEqual({
      objective: "Find AlphaFold structure information for this sequence",
    });
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

  test("runtime literature override forces non-AlphaFold source chips without rewriting query", () => {
    expect(
      resolveSourceSelectionLiteratureOverride({
        objective: "Find TP53 records",
        sourceSelectionId: "uniprot",
        userMessage: "Find TP53 records",
      })
    ).toEqual({
      objective: "Find TP53 records",
      sources: ["uniprot"],
    });
  });

  test("planning override attaches selected official source to literature tasks", () => {
    const plan = applySourceSelectionPlanningOverrides({
      plan: [
        {
          datasets: [],
          objective: "Find clinical trial data for rapamycin",
          type: "LITERATURE",
        },
        {
          datasets: [],
          objective: "Analyze uploaded table",
          type: "ANALYSIS",
        },
      ],
      sourceSelectionId: "clinical-trials",
      userMessage: "Find clinical trial data for rapamycin",
    });

    expect(plan[0]).toMatchObject({
      objective: "Find clinical trial data for rapamycin",
      sources: ["clinical-trials"],
      type: "LITERATURE",
    });
    expect(plan[1]?.sources).toBeUndefined();
  });

  test("promoted tasks receive source selection overrides after clarification planning", () => {
    const tasks = applySourceSelectionToPromotedTasks({
      sourceSelectionId: "uniprot",
      tasks: [
        {
          datasets: [],
          objective: "Find TP53 protein annotations",
          type: "LITERATURE",
        },
        {
          datasets: [],
          objective: "Analyze uploaded table",
          type: "ANALYSIS",
        },
      ],
      userMessage: "Find TP53 protein annotations",
    });

    expect(tasks[0]).toMatchObject({
      objective: "Find TP53 protein annotations",
      sources: ["uniprot"],
      type: "LITERATURE",
    });
    expect(tasks[1]?.sources).toBeUndefined();
  });

  test("promoted AlphaFold tasks collapse to a sequence-only literature lookup", () => {
    const sequence = "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP";
    const tasks = applySourceSelectionToPromotedTasks({
      sourceSelectionId: "alphafold_db",
      tasks: [
        {
          datasets: [],
          objective: "Find AlphaFold structure information for this protein",
          type: "LITERATURE",
        },
        {
          datasets: [],
          objective: "Summarize the sequence hit",
          type: "LITERATURE",
        },
        {
          datasets: [],
          objective: "Analyze uploaded table",
          type: "ANALYSIS",
        },
      ],
      userMessage: `Protein sequence: ${sequence}`,
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      objective: sequence,
      sources: ["alphafold_db"],
      type: "LITERATURE",
    });
    expect(tasks[1]?.type).toBe("ANALYSIS");
  });
});
