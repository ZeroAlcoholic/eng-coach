import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE, type LearnedItem, type Scenario } from "../../kernel/types";
import { band } from "./progress";
import { composeSystemInstruction } from "./prompt";

const scenario: Scenario = {
  id: "s1",
  title: "t",
  targetLanguage: "en",
  level: "B1",
  baseContext: "frame",
  contentContext: "ctx",
  coachRole: "coach",
  userRole: "learner",
  objectives: [],
  targetPhrases: [],
};

function item(text: string): LearnedItem {
  return {
    id: "i1",
    language: "en",
    kind: "phrase",
    text,
    meaning: "m",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("composeSystemInstruction — due-item sanitisation", () => {
  it("flattens newlines/extra whitespace so one item can't break the line structure", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [
      item("circle\n back\tto   this"),
    ]);
    expect(out).toContain("circle back to this");
    expect(out).not.toContain("circle\n back");
  });

  it("caps oversized item text and drops whitespace-only items entirely", () => {
    const long = "x".repeat(500);
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [item(long), item("  \n ")]);
    expect(out).toContain("x".repeat(80));
    expect(out).not.toContain("x".repeat(81));
    const blankOnly = composeSystemInstruction(scenario, DEFAULT_PROFILE, [item("  \n ")]);
    expect(blankOnly).not.toContain("Spaced review");
  });

  it("omits the spaced-review block when there is nothing due", () => {
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE, [])).not.toContain("Spaced review");
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE)).not.toContain("Spaced review");
  });
});

describe("band — display mapping for per-skill subscores", () => {
  it("maps 1–6 to CEFR letters", () => {
    expect(band(1)).toBe("A1");
    expect(band(6)).toBe("C2");
  });
  it("shows — (not A1) for missing/zero/out-of-range, unlike numToCefr's clamp", () => {
    expect(band(0)).toBe("—");
    expect(band(7)).toBe("—");
  });
});
