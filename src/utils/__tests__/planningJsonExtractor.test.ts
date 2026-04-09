import { describe, expect, test } from "bun:test";
import { extractPlanningResult } from "../planningJsonExtractor";

describe("extractPlanningResult", () => {
  test("strategy 1: direct JSON parse", () => {
    const json = JSON.stringify({
      currentObjective: "Find biomarkers",
      plan: [
        {
          datasets: [],
          level: 1,
          objective: "Search for biomarkers",
          output: "",
          type: "LITERATURE",
        },
      ],
    });
    const result = extractPlanningResult(json);
    expect(result.currentObjective).toBe("Find biomarkers");
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]!.type).toBe("LITERATURE");
  });

  test("strategy 2: JSON inside markdown code block", () => {
    const raw = `Here is the plan:\n\`\`\`json\n${JSON.stringify({
      currentObjective: "Analyze pathways",
      plan: [
        { datasets: [], level: 1, objective: "Run pathway analysis", output: "", type: "ANALYSIS" },
      ],
    })}\n\`\`\``;
    const result = extractPlanningResult(raw);
    expect(result.currentObjective).toBe("Analyze pathways");
    expect(result.plan[0]!.type).toBe("ANALYSIS");
  });

  test("strategy 3: find JSON object in surrounding text", () => {
    const json = JSON.stringify({
      currentObjective: "Test objective",
      plan: [{ datasets: [], level: 1, objective: "Search", output: "", type: "LITERATURE" }],
    });
    const raw = `Some preamble text. ${json} And some trailing text.`;
    const result = extractPlanningResult(raw);
    expect(result.currentObjective).toBe("Test objective");
    expect(result.plan).toHaveLength(1);
  });

  test("strategy 5: returns default with fallback objective for unparseable input", () => {
    const result = extractPlanningResult("completely unparseable garbage", "Fallback objective");
    expect(result.currentObjective).toBe("Fallback objective");
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]!.type).toBe("LITERATURE");
    expect(result.plan[0]!.objective).toBe("Fallback objective");
  });

  test("strategy 5: returns empty plan without fallback objective", () => {
    const result = extractPlanningResult("completely unparseable garbage");
    expect(result.currentObjective).toBe("Continue research based on user query");
    expect(result.plan).toHaveLength(0);
  });

  test("normalizes missing fields", () => {
    const json = JSON.stringify({ currentObjective: "Test", plan: [{}] });
    const result = extractPlanningResult(json);
    expect(result.plan[0]!.type).toBe("LITERATURE");
    expect(result.plan[0]!.objective).toBe("");
    expect(result.plan[0]!.datasets).toEqual([]);
    expect(result.plan[0]!.level).toBe(1);
    expect(result.plan[0]!.output).toBe("");
  });
});
