import { describe, expect, it } from "vitest";

import { Invalid } from "../../../kernel/validate";
import { reviewParser } from "./review";

const learner = ["I goed to the office yesterday.", "We discuss the budget."];
const parse = reviewParser(learner);

const good = {
  cefr: "B1",
  subscores: { grammar: 3, vocab: 4, fluency: 3, interaction: 4 },
  reviewEn: "Nice.",
  reviewZh: "不錯。",
  progressNote: "Past tense.",
  wins: ["kept going"],
  fixes: ["goed → went"],
  objectivesMet: [{ objective: "defend the budget", met: true }],
  errors: [{ type: "tense", example: "I goed to the office", correction: "I went to the office" }],
};

describe("judge validator — the recap claims only what the transcript can show", () => {
  it("accepts a well-formed sample and derives CEFR from grammar/vocab/interaction, not the headline", () => {
    const r = parse({ ...good, cefr: "C2" }, "$");
    expect(r.cefr).toBe("B2"); // (3+4+4)/3 = 3.67 → round 4 → B2
    expect(r.errors).toHaveLength(1);
    expect(r.objectivesMet).toEqual([{ objective: "defend the budget", met: true }]);
  });

  it("does not void a sample over the model's own cefr label (it is derived, not used)", () => {
    expect(parse({ ...good, cefr: "B1+" }, "$").cefr).toBe("B2");
  });

  it("rejects a sample with a subscore outside 1–6 (or missing)", () => {
    expect(() => parse({ ...good, subscores: { ...good.subscores, grammar: 9 } }, "$")).toThrow(Invalid);
    expect(() => parse({ ...good, subscores: { grammar: 3, vocab: 3 } }, "$")).toThrow(Invalid);
    expect(() => parse({ ...good, subscores: undefined }, "$")).toThrow(Invalid);
  });

  it("drops an error whose example the learner never said (invented evidence)", () => {
    const r = parse(
      { ...good, errors: [{ type: "article", example: "I bought a apple", correction: "an apple" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("an example that appears only in a COACH turn is still invented evidence", () => {
    const withCoach = reviewParser(["I goed home."]);
    const r = withCoach(
      { ...good, errors: [{ type: "tense", example: "I goed to the office", correction: "went" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("drops a pronunciation error — a text transcript cannot evidence it", () => {
    const r = parse(
      { ...good, errors: [{ type: "pronunciation", example: "I goed", correction: "went" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("matches the example case- and whitespace-insensitively (ASR punctuation drift)", () => {
    const r = parse({ ...good, errors: [{ type: "tense", example: "  i GOED to the   office", correction: "went" }] }, "$");
    expect(r.errors).toHaveLength(1);
  });

  it("drops a malformed verdict but keeps the rest", () => {
    const r = parse({ ...good, objectivesMet: [{ objective: "x", met: "yes" }, { objective: "y", met: false }] }, "$");
    expect(r.objectivesMet).toEqual([{ objective: "y", met: false }]);
  });

  it("rejects a non-object response", () => {
    expect(() => parse("B1", "$")).toThrow(Invalid);
  });
});
