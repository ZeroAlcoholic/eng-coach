import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE } from "../../kernel/types";
import { DEFAULT_SCENARIOS } from "./defaults";
import { composeSystemInstruction } from "./prompt";

const HEAD = "── How you sound — warm, upbeat, a little fun ──";

describe("every coach sounds warm, reacts for real and jokes lightly", () => {
  it("every shipped scene's instruction carries the manner block before the turn rules", () => {
    for (const lang of ["en", "ja"] as const) {
      for (const s of DEFAULT_SCENARIOS[lang]) {
        const p = composeSystemInstruction(s, DEFAULT_PROFILE);
        expect(p, s.id).toContain(HEAD);
        expect(p.indexOf(HEAD), s.id).toBeLessThan(p.indexOf("── Each turn"));
        expect(p, s.id).toContain("never a stock 「Great job!」");
        expect(p, s.id).toContain("Never joke about the learner");      }
    }
  });

  it("only the Japanese beginner gets the per-line cheer", () => {
    const en = composeSystemInstruction(DEFAULT_SCENARIOS.en[0], DEFAULT_PROFILE);
    const ja = composeSystemInstruction(DEFAULT_SCENARIOS.ja[0], DEFAULT_PROFILE);
    expect(ja).toContain("the first try at each new Japanese line deserves a quick, real cheer");
    expect(en).not.toContain("Japanese line");
  });

  it("the Japanese hook stays within the no-why-question rule; the English hook stays open", () => {
    for (const s of DEFAULT_SCENARIOS.ja) {
      const p = composeSystemInstruction(s, DEFAULT_PROFILE);
      expect(p, s.id).not.toContain("「How so?」");
      expect(p, s.id).toContain("two choices, or one word: いつ？ どこ？");
    }
    for (const s of DEFAULT_SCENARIOS.en) {
      const p = composeSystemInstruction(s, DEFAULT_PROFILE);
      expect(p, s.id).toContain("「How so?」");
      expect(p, s.id).not.toContain("いつ？ どこ？)");
    }
  });
});
