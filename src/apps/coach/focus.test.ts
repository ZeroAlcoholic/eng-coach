import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE, type LearnerProfile, type SessionReview } from "../../kernel/types";
import { describeFocus, microInstruction, pickFocus, structuredFocus } from "./focus";

const base: SessionReview = { cefr: "B1", reviewEn: "", reviewZh: "", progressNote: "" };
const e = (type: NonNullable<SessionReview["errors"]>[number]["type"]) => ({ type, example: `ex-${type}`, correction: `fix-${type}` });
const gaps = [
  { said: "預約", target: "book" },
  { said: "幾點", target: "what time" },
];

const recurringProfile: LearnerProfile = {
  ...DEFAULT_PROFILE,
  errorLog: { en: { article: { count: 3, lastAt: "t" } } },
};

describe("pickFocus — one focus, by priority: meaning > gap > recurring > cando", () => {
  it("a meaning-blocking error wins over a gap, a recurring error and an unmet can-do", () => {
    const f = pickFocus(
      { ...base, errors: [e("article"), e("wordOrder")], l1Fallbacks: gaps, objectivesMet: [{ objective: "o", met: false }] },
      recurringProfile,
      "en",
    );
    expect(f).toMatchObject({ kind: "meaning", type: "wordOrder" });
  });

  it("two or more Chinese fallbacks make a gap, which beats a recurring error and an unmet can-do", () => {
    const f = pickFocus(
      { ...base, errors: [e("article")], l1Fallbacks: gaps, objectivesMet: [{ objective: "o", met: false }] },
      recurringProfile,
      "en",
    );
    expect(f).toEqual({ kind: "gap", gaps });
  });

  it("a single Chinese fallback is a slip, not a gap: the recurring error wins", () => {
    const f = pickFocus({ ...base, errors: [e("article")], l1Fallbacks: gaps.slice(0, 1) }, recurringProfile, "en");
    expect(f).toMatchObject({ kind: "recurring", type: "article", sessions: 3 });
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

  it("the gap drill names every target word and none of the Chinese the learner said", () => {
    const f = pickFocus({ ...base, l1Fallbacks: gaps }, DEFAULT_PROFILE, "en")!;
    expect(describeFocus(f)).toContain("預約→book");
    const drill = microInstruction(f);
    expect(drill).toContain("book");
    expect(drill).toContain("what time");
    expect(drill).not.toContain("預約");
    expect(drill).not.toContain("幾點");
    expect(drill).toContain("WHOLE sentence");
  });
});

describe("structuredFocus — what a stored focus means", () => {
  it("a structured focus is itself; a string (older micro record) or nothing is unknown", () => {
    expect(structuredFocus({ kind: "cando", objective: "o" })).toEqual({ kind: "cando", objective: "o" });
    expect(structuredFocus("時態：你說「x」")).toBeNull();
    expect(structuredFocus(undefined)).toBeNull();
  });
});
