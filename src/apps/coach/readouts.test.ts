import { describe, expect, it } from "vitest";

import type { LearnedItem, Scenario, SessionRecord, SessionReview } from "../../kernel/types";
import { computeReadouts } from "./readouts";

const sc = (id: string, lang: "en" | "ja" = "en"): Scenario => ({
  id,
  title: id,
  targetLanguage: lang,
  level: "B1",
  baseContext: "",
  contentContext: "",
  coachRole: "",
  userRole: "",
  objectives: [],
  targetPhrases: [],
});

const review = (met: boolean[], errors: SessionReview["errors"] = []): SessionReview => ({
  cefr: "B1",
  reviewEn: "",
  reviewZh: "",
  progressNote: "",
  objectivesMet: met.map((m, i) => ({ objective: `o${i}`, met: m })),
  errors,
});

function session(id: string, day: number, opts: { review?: SessionReview; aids?: SessionRecord["aids"]; kind?: "micro"; scenarioId?: string } = {}): SessionRecord {
  return {
    id,
    scenarioId: opts.scenarioId ?? "sc1",
    startedAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    transcript: [{ who: "user", text: "hi" }],
    review: opts.review,
    aids: opts.aids,
    kind: opts.kind,
  };
}

const err = (type: SessionReview["errors"] extends (infer E)[] | undefined ? (E extends { type: infer T } ? T : never) : never) => ({
  type,
  example: "x",
  correction: "y",
});

const scenarios = [sc("sc1"), sc("ja1", "ja")];

describe("computeReadouts — hand-computed fixtures", () => {
  it("0 sessions: every readout is null with an empty denominator", () => {
    const r = computeReadouts({ sessions: [], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: null, n: 0, trend: null, sourceSessionIds: [] });
    expect(r.chunkUse).toMatchObject({ value: null, n: 0 });
    expect(r.errorRecurrence).toMatchObject({ value: null, n: 0 });
  });

  it("1 session, unaided, 2 of 3 met, one error type: can-do 2/3, recurrence 0/1, no trend yet", () => {
    const s = session("s1", 1, { review: review([true, true, false], [err("tense")]), aids: { suggestions: 0, translations: 0 } });
    const r = computeReadouts({ sessions: [s], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 2 / 3, n: 3, trend: null, sourceSessionIds: ["s1"] });
    expect(r.errorRecurrence).toMatchObject({ value: 0, n: 1, sourceSessionIds: [] });
  });

  it("an aided session's verdicts are excluded; a session without aids info is excluded too (not assumed unaided)", () => {
    const aided = session("a", 1, { review: review([true, true]), aids: { suggestions: 1, translations: 0 } });
    const unknown = session("u", 2, { review: review([true]) });
    const clean = session("c", 3, { review: review([false, true]), aids: { suggestions: 0, translations: 0 } });
    const r = computeReadouts({ sessions: [aided, unknown, clean], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 0.5, n: 2, sourceSessionIds: ["c"] });
  });

  it("5+ sessions: recurrence counts types seen in ≥2 sessions, trend compares halves, sources are the recurring sessions", () => {
    const zero = { suggestions: 0, translations: 0 };
    const sessions = [
      session("s1", 1, { review: review([false, false], [err("tense"), err("article")]), aids: zero }),
      session("s2", 2, { review: review([false, true], [err("tense")]), aids: zero }),
      session("s3", 3, { review: review([true, true], [err("plural")]), aids: zero }),
      session("s4", 4, { review: review([true, true], []), aids: zero }),
      session("s5", 5, { review: review([true, true], [err("preposition")]), aids: zero }),
      session("micro", 6, { kind: "micro" }),
      session("ja", 7, { review: review([false]), aids: zero, scenarioId: "ja1" }),
    ];
    const r = computeReadouts({ sessions, items: [], scenarios, language: "en" });
    // types: tense (s1,s2), article (s1), plural (s3), preposition (s5) → 1 of 4 recurring
    expect(r.errorRecurrence).toMatchObject({ value: 0.25, n: 4, betterWhen: "low" });
    expect(r.errorRecurrence.sourceSessionIds.sort()).toEqual(["s1", "s2"]);
    // can-do: 7 met of 10 verdicts; earlier half (s1,s2) 1/4, recent half (s3..s5) 6/6 → up
    expect(r.unaidedCanDo).toMatchObject({ value: 0.7, n: 10, trend: "up" });
    expect(r.unaidedCanDo.sourceSessionIds).not.toContain("ja");
    expect(r.unaidedCanDo.sourceSessionIds).not.toContain("micro");
  });

  it("chunk use: only items taught before the latest session count; used ones point at the sessions they were used in", () => {
    const item = (id: string, firstSeenAt: string, uses?: LearnedItem["uses"]): LearnedItem => ({
      id,
      language: "en",
      kind: "phrase",
      text: id,
      meaning: "",
      firstSeenAt,
      uses,
    });
    const sessions = [session("s1", 1, { review: review([true]) }), session("s2", 5, { review: review([true]) })];
    const items = [
      item("old-used", "2026-09-01T00:00:00.000Z", [{ sessionId: "s2", at: "t" }]),
      item("old-unused", "2026-09-02T00:00:00.000Z"),
      item("just-taught", "2026-09-05T00:00:00.000Z"), // no later session yet → no chance
    ];
    const r = computeReadouts({ sessions, items, scenarios, language: "en" });
    expect(r.chunkUse).toMatchObject({ value: 0.5, n: 2, sourceSessionIds: ["s2"] });
  });
});
