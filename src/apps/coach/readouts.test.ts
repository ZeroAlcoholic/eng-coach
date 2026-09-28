import { describe, expect, it } from "vitest";

import type { ErrorType, LearnedItem, Scenario, SessionFocus, SessionRecord, SessionReview, TranscriptTurn } from "../../kernel/types";
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

const zero = { suggestions: 0, translations: 0 };

interface Opts {
  review?: SessionReview;
  aids?: SessionRecord["aids"];
  kind?: "micro";
  scenarioId?: string;
  focus?: SessionFocus | string;
  drilledFocus?: { sourceSessionId: string };
  recycled?: string[];
  transcript?: TranscriptTurn[];
}

function session(id: string, day: number, opts: Opts = {}): SessionRecord {
  return {
    id,
    scenarioId: opts.scenarioId ?? "sc1",
    startedAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    transcript: opts.transcript ?? [{ who: "user", text: "hi" }],
    review: opts.review,
    aids: opts.aids,
    kind: opts.kind,
    focus: opts.focus,
    drilledFocus: opts.drilledFocus,
    recycled: opts.recycled,
  };
}

const err = (type: ErrorType) => ({ type, example: "x", correction: "y" });
const meaning = (type: ErrorType): SessionFocus => ({ kind: "meaning", type, example: "x", correction: "y" });

const scenarios = [sc("sc1"), sc("ja1", "ja")];

describe("computeReadouts — hand-computed fixtures", () => {
  it("0 sessions: every readout is null with an empty denominator", () => {
    const r = computeReadouts({ sessions: [], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: null, n: 0, trend: null, sourceSessionIds: [] });
    expect(r.chunkUse).toMatchObject({ value: null, n: 0 });
    expect(r.focusResolution).toMatchObject({ value: null, n: 0, drilled: { value: null, n: 0 }, undrilled: { value: null, n: 0 } });
  });

  it("1 session, unaided, 2 of 3 met, a focus with no follow-up yet: can-do 2/3, focus null, no trend", () => {
    const s = session("s1", 1, { review: review([true, true, false], [err("tense")]), aids: zero, focus: meaning("tense") });
    const r = computeReadouts({ sessions: [s], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 2 / 3, n: 3, trend: null, sourceSessionIds: ["s1"] });
    expect(r.focusResolution).toMatchObject({ value: null, n: 0, sourceSessionIds: [] });
  });

  it("an aided session's verdicts are excluded; a session without aids info is excluded too (not assumed unaided)", () => {
    const aided = session("a", 1, { review: review([true, true]), aids: { suggestions: 1, translations: 0 } });
    const unknown = session("u", 2, { review: review([true]) });
    const clean = session("c", 3, { review: review([false, true]), aids: zero });
    const r = computeReadouts({ sessions: [aided, unknown, clean], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 0.5, n: 2, sourceSessionIds: ["c"] });
  });

  it("a spoken help request (an aided turn) makes the session aided even with zero button taps", () => {
    const spoken = session("sp", 1, {
      review: review([true, true]),
      aids: zero,
      transcript: [
        { who: "user", text: "這個怎麼說" },
        { who: "user", text: "I'd like a refund", aided: true },
      ],
    });
    const clean = session("c", 2, { review: review([false, true]), aids: zero });
    const r = computeReadouts({ sessions: [spoken, clean], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 0.5, n: 2, sourceSessionIds: ["c"] });
  });

  it("5+ sessions: focus resolution counts a focus resolved when its type stays away for the next TWO full sessions", () => {
    const sessions = [
      session("s1", 1, { review: review([false, false], [err("tense"), err("article")]), aids: zero, focus: meaning("tense") }),
      session("s2", 2, { review: review([false, true], [err("tense")]), aids: zero, focus: meaning("tense") }),
      session("s3", 3, { review: review([true, true], [err("plural")]), aids: zero, focus: meaning("plural") }),
      session("s4", 4, { review: review([true, true], []), aids: zero, focus: { kind: "cando", objective: "o" } }),
      session("s5", 5, { review: review([true, true], [err("preposition")]), aids: zero, focus: meaning("preposition") }),
      session("micro", 6, { kind: "micro", drilledFocus: { sourceSessionId: "s3" } }),
      session("ja", 7, { review: review([false]), aids: zero, scenarioId: "ja1" }),
    ];
    const r = computeReadouts({ sessions, items: [], scenarios, language: "en" });
    // s1 tense → recurs in s2 → not resolved; s2 tense → s3,s4 clean → resolved;
    // s3 plural → s4,s5 clean → resolved (drilled); s4 cando → not an error type;
    // s5 → fewer than two follow-ups → unknown.  → 2 of 3
    expect(r.focusResolution).toMatchObject({ value: 2 / 3, n: 3, betterWhen: "high" });
    expect(r.focusResolution.sourceSessionIds).toEqual(["s1", "s2", "s3"]);
    expect(r.focusResolution.drilled).toEqual({ value: 1, n: 1, sourceSessionIds: ["s3"] });
    expect(r.focusResolution.undrilled).toEqual({ value: 0.5, n: 2, sourceSessionIds: ["s1", "s2"] });
    // can-do: 7 met of 10 verdicts; earlier half (s1,s2) 1/4, recent half (s3..s5) 6/6 → up
    expect(r.unaidedCanDo).toMatchObject({ value: 0.7, n: 10, trend: "up" });
    expect(r.unaidedCanDo.sourceSessionIds).not.toContain("ja");
    expect(r.unaidedCanDo.sourceSessionIds).not.toContain("micro");
  });

  it("sessions with an identical startedAt are ordered by id, so the input order cannot change a readout", () => {
    const mk = (id: string) => session(id, 1, { review: review([true], id === "a" ? [err("tense")] : []), aids: zero, focus: id === "a" ? meaning("tense") : undefined });
    const forward = computeReadouts({ sessions: [mk("a"), mk("b"), mk("c")], items: [], scenarios, language: "en" });
    const backward = computeReadouts({ sessions: [mk("c"), mk("b"), mk("a")], items: [], scenarios, language: "en" });
    expect(backward).toEqual(forward);
    expect(forward.focusResolution).toMatchObject({ value: 1, n: 1 });
  });

  it("a micro session pointing at a session outside the input, or whose scenario is gone, changes nothing", () => {
    const sessions = [
      session("s1", 1, { review: review([true], [err("tense")]), aids: zero, focus: meaning("tense") }),
      session("s2", 2, { review: review([true], []), aids: zero }),
      session("s3", 3, { review: review([true], []), aids: zero }),
      session("m-gone", 4, { kind: "micro", drilledFocus: { sourceSessionId: "s1" }, scenarioId: "gone" }),
      session("m-else", 5, { kind: "micro", drilledFocus: { sourceSessionId: "nowhere" } }),
    ];
    const r = computeReadouts({ sessions, items: [], scenarios, language: "en" });
    expect(r.focusResolution.undrilled).toMatchObject({ value: 1, n: 1, sourceSessionIds: ["s1"] });
    expect(r.focusResolution.drilled).toMatchObject({ value: null, n: 0 });
  });

  it("focus resolution looks past the window: a focus outside the window is not counted, one inside gets follow-ups from beyond it", () => {
    const sessions = [
      session("old", 1, { review: review([true], [err("tense")]), aids: zero, focus: meaning("tense") }),
      session("n1", 2, { review: review([true], []), aids: zero }),
      session("n2", 3, { review: review([true], []), aids: zero }),
    ];
    const r = computeReadouts({ sessions, items: [], scenarios, language: "en", window: 1 });
    // window = [n2] only → no focus in the window → null; with window 3 the old focus is resolved
    expect(r.focusResolution).toMatchObject({ value: null, n: 0 });
    expect(computeReadouts({ sessions, items: [], scenarios, language: "en", window: 3 }).focusResolution).toMatchObject({ value: 1, n: 1 });
  });

  it("a session whose scenario was deleted is excluded (its language is unknowable) rather than guessed", () => {
    const kept = session("kept", 1, { review: review([true]), aids: zero });
    const orphan = session("orphan", 2, { review: review([false, false]), aids: zero, scenarioId: "gone" });
    const r = computeReadouts({ sessions: [kept, orphan], items: [], scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 1, n: 1, sourceSessionIds: ["kept"] });
  });

  it("chunk use: three items recycled, one produced in that session → 1/3; the use must be in THAT session", () => {
    const item = (id: string, uses?: LearnedItem["uses"]): LearnedItem => ({
      id,
      language: "en",
      kind: "phrase",
      text: id,
      meaning: "",
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      uses,
    });
    const items = [item("a", [{ sessionId: "s2", at: "t" }]), item("b", [{ sessionId: "s1", at: "t" }]), item("c")];
    const sessions = [
      session("s1", 1, { review: review([true]), aids: zero }), // no recycled record → unknown, not in the denominator
      session("s2", 5, { review: review([true]), aids: zero, recycled: ["a", "b", "c"] }),
    ];
    const r = computeReadouts({ sessions, items, scenarios, language: "en" });
    expect(r.chunkUse).toMatchObject({ value: 1 / 3, n: 3, sourceSessionIds: ["s2"] });
  });
});

describe("computeReadouts — records from before this build", () => {
  it("string focus, no recycled, no turn flags: can-do reads as before; chunk use and focus resolution are unknown (null), never a number", () => {
    const sessions = [
      session("s1", 1, { review: review([true, false], [err("tense")]), aids: zero }),
      session("s2", 2, { review: review([true, true], [err("tense")]), aids: zero }),
      session("s3", 3, { review: review([true], []), aids: zero }),
      session("m", 4, { kind: "micro", focus: "時態：你說「x」→「y」" }),
    ];
    const items: LearnedItem[] = [
      { id: "i", language: "en", kind: "word", text: "i", meaning: "", firstSeenAt: "2026-08-01T00:00:00.000Z", uses: [{ sessionId: "s3", at: "t" }] },
    ];
    const r = computeReadouts({ sessions, items, scenarios, language: "en" });
    expect(r.unaidedCanDo).toMatchObject({ value: 0.8, n: 5, sourceSessionIds: ["s1", "s2", "s3"] });
    expect(r.chunkUse).toMatchObject({ value: null, n: 0, sourceSessionIds: [] });
    expect(r.focusResolution).toMatchObject({ value: null, n: 0, sourceSessionIds: [] });
    expect(Number.isNaN(r.unaidedCanDo.value)).toBe(false);
  });
});
