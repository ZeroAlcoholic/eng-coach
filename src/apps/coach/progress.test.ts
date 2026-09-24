import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE, type ErrorType, type LearnerProfile, type SessionReview } from "../../kernel/types";
import {
  applyErrorsToProfile,
  applySessionToProfile,
  cefrToNum,
  coachPolicy,
  isErrorType,
  levelSummary,
  median,
  medianReview,
  numToCefr,
  recurringErrors,
  voteErrors,
} from "./progress";

const baseProfile: LearnerProfile = { language: "en", level: "B1", focus: [] };
const review = (cefr: string, subs?: [number, number, number, number]): SessionReview => ({
  cefr,
  reviewEn: "",
  reviewZh: "",
  progressNote: "",
  subscores: subs ? { grammar: subs[0], vocab: subs[1], fluency: subs[2], interaction: subs[3] } : undefined,
});

describe("cefr <-> num", () => {
  it("round-trips", () => {
    expect(cefrToNum("A1")).toBe(1);
    expect(cefrToNum("C2")).toBe(6);
    expect(cefrToNum("???")).toBe(3); // unknown → B1
    expect(numToCefr(1)).toBe("A1");
    expect(numToCefr(6)).toBe("C2");
    expect(numToCefr(99)).toBe("C2"); // clamped
  });
});

describe("median", () => {
  it("odd and even", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("medianReview", () => {
  it("medians cefr + subscores, keeps first prose", () => {
    const r = medianReview([
      { ...review("B1", [3, 3, 3, 3]), reviewEn: "first" },
      review("B2", [4, 4, 2, 4]),
      review("B1", [3, 4, 3, 3]),
    ]);
    expect(r.cefr).toBe("B1"); // median of B1,B2,B1
    expect(r.subscores).toEqual({ grammar: 3, vocab: 4, fluency: 3, interaction: 3 });
    expect(r.reviewEn).toBe("first");
  });
});

describe("applySessionToProfile", () => {
  it("seeds on first session", () => {
    const p = applySessionToProfile(baseProfile, review("A2", [2, 2, 2, 2]), "2026-01-01T00:00:00Z");
    expect(p.levels?.en).toEqual({ grammar: 2, vocab: 2, fluency: 2, interaction: 2 });
    expect(p.levelHistory?.en?.length).toBe(1);
  });
  it("EWMA-blends subsequent sessions (does not overwrite)", () => {
    let p = applySessionToProfile(baseProfile, review("A2", [2, 2, 2, 2]), "t1");
    p = applySessionToProfile(p, review("B2", [4, 4, 4, 4]), "t2");
    // 0.25*4 + 0.75*2 = 2.5 — blended, not jumped to 4
    expect(p.levels?.en?.grammar).toBeCloseTo(2.5, 5);
    expect(p.levelHistory?.en?.length).toBe(2);
  });
  it("ignores a review with no subscores", () => {
    const p = applySessionToProfile(baseProfile, review("B1"), "t");
    expect(p.levels).toBeUndefined();
  });
  it("caps history at 30", () => {
    let p = baseProfile;
    for (let i = 0; i < 35; i++) p = applySessionToProfile(p, review("B1", [3, 3, 3, 3]), `t${i}`);
    expect(p.levelHistory?.en?.length).toBe(30);
  });
});

describe("levelSummary", () => {
  it("null when no data", () => {
    expect(levelSummary(baseProfile, "en")).toBeNull();
  });
  it("reports band and an upward trend", () => {
    let p = applySessionToProfile(baseProfile, review("A2", [2, 2, 2, 2]), "t1");
    p = applySessionToProfile(p, review("B2", [5, 5, 5, 5]), "t2");
    p = applySessionToProfile(p, review("B2", [5, 5, 5, 5]), "t3");
    const s = levelSummary(p, "en");
    expect(s?.trend).toBe("up");
    expect(s?.sessions).toBe(3);
  });
});

describe("coachPolicy", () => {
  it("novice gets heavy support + explicit correction", () => {
    const pol = coachPolicy(baseProfile, "en", 2); // no measured levels → use scenario num 2
    expect(pol).toMatchObject({ l1: "high", speed: "slow", correction: "explicit", scaffold: "model" });
  });
  it("advanced measured level gets minimal support + recast", () => {
    const p = applySessionToProfile(baseProfile, review("C1", [5, 5, 5, 5]), "t");
    const pol = coachPolicy(p, "en", 3);
    expect(pol).toMatchObject({ l1: "minimal", correction: "recast", scaffold: "extend" });
  });
  it("uses the practised language's level, not the toggle's", () => {
    // measured EN level is high, but practising JA (no JA data) → falls back to scenario num
    const p = applySessionToProfile(baseProfile, review("C1", [6, 6, 6, 6]), "t");
    expect(coachPolicy(p, "ja", 2)).toMatchObject({ l1: "high" }); // ja has no levels → novice
  });
});

// --- E1: typed error patterns -----------------------------------------------

const errReview = (types: string[]): SessionReview => ({
  cefr: "B1",
  reviewEn: "",
  reviewZh: "",
  progressNote: "",
  errors: types.map((t) => ({
    type: t as ErrorType,
    example: `said ${t}`,
    correction: `fixed ${t}`,
  })),
});

describe("E1 voteErrors — types must agree across samples; a lone sample stands on its validator", () => {
  it("keeps only types a MAJORITY of samples named", () => {
    const voted = voteErrors([
      errReview(["tense", "article"]),
      errReview(["tense"]),
      errReview(["plural"]),
    ]);
    expect(voted?.map((e) => e.type)).toEqual(["tense"]);
  });

  it("a single sample keeps its (already validated) errors, deduped by type; none → none", () => {
    expect(voteErrors([errReview(["tense", "tense", "article"])])?.map((e) => e.type)).toEqual(["tense", "article"]);
    expect(voteErrors([])).toEqual([]);
  });

  it("counts one vote per sample, so a repeat inside one sample can't self-confirm", () => {
    expect(voteErrors([errReview(["tense", "tense"]), errReview(["article"])])).toEqual([]);
  });

  it("drops types outside the closed enum instead of trusting the model", () => {
    expect(voteErrors([errReview(["subjunctive-mood"]), errReview(["subjunctive-mood"])])).toEqual([]);
    expect(isErrorType("tense")).toBe(true);
    expect(isErrorType("subjunctive-mood")).toBe(false);
    expect(isErrorType(undefined)).toBe(false);
  });

  it("carries the learner's OWN wording through from the first sample that named it", () => {
    const voted = voteErrors([errReview(["particle"]), errReview(["particle"])]);
    expect(voted?.[0]).toMatchObject({ example: "said particle", correction: "fixed particle" });
  });

  it("is applied by medianReview, so the judge's aggregate is already de-noised", () => {
    const merged = medianReview([errReview(["tense"]), errReview(["tense"]), errReview(["article"])]);
    expect(merged.errors?.map((e) => e.type)).toEqual(["tense"]);
  });

  // Regression: summariseSession used to return valid[0] when only one of the three
  // self-consistency samples survived (a throttled minute), routing around the vote
  // and letting one noisy read into the permanent tally. It now always merges, so
  // merging a LONE sample must still yield zero confirmed errors while keeping prose.
  it("merging a single sample keeps its prose but confirms no errors", () => {
    const merged = medianReview([{ ...errReview(["tense"]), reviewEn: "solo", cefr: "B2" }]);
    expect(merged.errors).toEqual([]);
    expect(merged.reviewEn).toBe("solo");
    expect(merged.cefr).toBe("B2");
  });
});

describe("E1 applyErrorsToProfile / recurringErrors — accumulation across sessions", () => {
  const at = (d: string) => `2026-08-0${d}T00:00:00.000Z`;

  it("counts SESSIONS, not occurrences, and keys per language", () => {
    let p = applyErrorsToProfile(DEFAULT_PROFILE, "en", errReview(["tense", "tense"]).errors, at("1"));
    p = applyErrorsToProfile(p, "en", errReview(["tense"]).errors, at("2"));
    p = applyErrorsToProfile(p, "ja", errReview(["particle"]).errors, at("2"));
    expect(p.errorLog?.en?.tense).toMatchObject({ count: 2, lastAt: at("2") });
    expect(p.errorLog?.ja?.particle?.count).toBe(1);
    expect(p.errorLog?.ja?.tense).toBeUndefined();
  });

  it("is a no-op when nothing was confirmed", () => {
    expect(applyErrorsToProfile(DEFAULT_PROFILE, "en", [], at("1"))).toBe(DEFAULT_PROFILE);
    expect(applyErrorsToProfile(DEFAULT_PROFILE, "en", undefined, at("1"))).toBe(DEFAULT_PROFILE);
  });

  it("only calls something recurring after two sessions, most frequent first", () => {
    let p = applyErrorsToProfile(DEFAULT_PROFILE, "en", errReview(["tense", "article"]).errors, at("1"));
    expect(recurringErrors(p, "en")).toEqual([]); // one session is not a habit
    p = applyErrorsToProfile(p, "en", errReview(["tense", "article"]).errors, at("2"));
    p = applyErrorsToProfile(p, "en", errReview(["tense"]).errors, at("3"));
    expect(recurringErrors(p, "en").map((r) => r.type)).toEqual(["tense", "article"]);
    expect(recurringErrors(p, "en", 1).map((r) => r.type)).toEqual(["tense"]);
    expect(recurringErrors(p, "ja")).toEqual([]);
  });
});
