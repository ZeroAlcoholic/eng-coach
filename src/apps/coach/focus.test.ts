import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE, type LearnerProfile, type SessionReview } from "../../kernel/types";
import { describeFocus, microInstruction, pickFocus } from "./focus";

const base: SessionReview = { cefr: "B1", reviewEn: "", reviewZh: "", progressNote: "" };
const e = (type: NonNullable<SessionReview["errors"]>[number]["type"]) => ({ type, example: `ex-${type}`, correction: `fix-${type}` });

const recurringProfile: LearnerProfile = {
  ...DEFAULT_PROFILE,
  errorLog: { en: { article: { count: 3, lastAt: "t" } } },
};

describe("pickFocus — one focus, by priority", () => {
  it("a meaning-blocking error wins over a recurring one and an unmet can-do", () => {
    const f = pickFocus(
      { ...base, errors: [e("article"), e("wordOrder")], objectivesMet: [{ objective: "o", met: false }] },
      recurringProfile,
      "en",
    );
    expect(f).toMatchObject({ kind: "meaning", type: "wordOrder" });
  });

  it("a recurring error (≥2 sessions in the log) wins over an unmet can-do", () => {
    const f = pickFocus({ ...base, errors: [e("article")], objectivesMet: [{ objective: "o", met: false }] }, recurringProfile, "en");
    expect(f).toMatchObject({ kind: "recurring", type: "article", sessions: 3 });
  });

  it("a one-off, non-blocking error does not beat an unmet can-do", () => {
    const f = pickFocus({ ...base, errors: [e("plural")], objectivesMet: [{ objective: "ask for a discount", met: false }] }, DEFAULT_PROFILE, "en");
    expect(f).toEqual({ kind: "cando", objective: "ask for a discount" });
  });

  it("nothing to focus on → null (no invented focus)", () => {
    expect(pickFocus({ ...base, objectivesMet: [{ objective: "o", met: true }] }, DEFAULT_PROFILE, "en")).toBeNull();
  });

  it("describes and drills the focus without reminder wording", () => {
    const f = pickFocus({ ...base, errors: [e("tense")] }, DEFAULT_PROFILE, "en")!;
    expect(describeFocus(f)).toContain("ex-tense");
    const drill = microInstruction(f);
    expect(drill).toContain("fix-tense");
    expect(drill).toMatch(/90/);
    expect(drill).not.toMatch(/每天|提醒|streak|連續/);
  });
});
