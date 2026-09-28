import { describe, expect, it } from "vitest";

import { Invalid, parsePack, summariseImport } from "./packSchema";

const scenario = {
  id: "sc1",
  title: "Budget review",
  targetLanguage: "en",
  level: "B1",
  baseContext: "b",
  contentContext: "c",
  coachRole: "CFO",
  userRole: "PM",
  objectives: ["defend"],
  targetPhrases: ["circle back"],
};

const item = {
  id: "it1",
  language: "en",
  kind: "phrase",
  text: "circle back",
  meaning: "回頭再談",
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  srs: { due: "2026-09-10T00:00:00.000Z", intervalDays: 3, reps: 2, fsrs: { stability: 3.2, difficulty: 5.1, due: "2026-09-10T00:00:00.000Z" } },
};

const session = {
  id: "s1",
  scenarioId: "sc1",
  startedAt: "2026-09-02T00:00:00.000Z",
  transcript: [
    { who: "coach", text: "Hi" },
    { who: "user", text: "Hello" },
  ],
  review: { cefr: "B1", subscores: { grammar: 3, vocab: 3, fluency: 3, interaction: 3 }, reviewEn: "", reviewZh: "", progressNote: "n" },
};

const arc = {
  id: "arc1",
  title: "Trip",
  targetLanguage: "en",
  level: "B1",
  premise: "p",
  episodes: [{ n: 1, scenarioId: "sc1", title: "Ep1" }],
  plannedEpisodes: 6,
  storyState: { characters: [{ name: "Ken", note: "boss" }], events: [], openThreads: ["deadline"] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const valid = { version: 1, kind: "learning-pack", exportedAt: "2026-09-03T00:00:00.000Z", scenarios: [scenario], items: [item], sessions: [session], arcs: [arc] };

describe("parsePack — one invalid record refuses the whole pack", () => {
  it("accepts a valid pack and keeps FSRS state through the round-trip", () => {
    const p = parsePack(valid);
    expect(p.scenarios).toHaveLength(1);
    expect(p.items[0].srs).toEqual(item.srs);
    expect(p.sessions[0].review?.cefr).toBe("B1");
    expect(p.arcs[0].episodes[0].scenarioId).toBe("sc1");
  });

  it("refuses a scenario with an illegal language", () => {
    expect(() => parsePack({ ...valid, scenarios: [{ ...scenario, targetLanguage: "fr" }] })).toThrow(/scenarios\[0\]\.targetLanguage/);
  });

  it("refuses a scenario missing objectives", () => {
    const noObjectives: Record<string, unknown> = { ...scenario };
    delete noObjectives.objectives;
    expect(() => parsePack({ ...valid, scenarios: [noObjectives] })).toThrow(/scenarios\[0\]\.objectives/);
  });

  it("refuses a session whose transcript has the wrong type", () => {
    expect(() => parsePack({ ...valid, sessions: [{ ...session, transcript: "Hello" }] })).toThrow(/sessions\[0\]\.transcript/);
    expect(() => parsePack({ ...valid, sessions: [{ ...session, transcript: [{ who: "bot", text: "x" }] }] })).toThrow(
      /transcript\[0\]\.who/,
    );
  });

  it("refuses an arc whose episode points at a scenario in neither the pack nor the store", () => {
    expect(() => parsePack({ ...valid, scenarios: [] })).toThrow(/arcs\[0\]\.episodes\[0\]\.scenarioId/);
    // …but accepts it when the store already has that scenario
    expect(() => parsePack({ ...valid, scenarios: [] }, new Set(["sc1"]))).not.toThrow();
  });

  it("refuses an unsupported version and a non-pack file", () => {
    expect(() => parsePack({ ...valid, version: 2 })).toThrow(/版本 2/);
    expect(() => parsePack({ kind: "something-else" })).toThrow(Invalid);
    expect(() => parsePack("[]")).toThrow(Invalid);
  });

  it("refuses a profile with a level outside CEFR", () => {
    expect(() => parsePack({ ...valid, profile: { language: "en", level: "Z9", focus: [] } })).toThrow(/profile\.level/);
  });
});

describe("parsePack — learning state survives the round-trip", () => {
  it("keeps profile levels / history / error log / prefs, and the new session fields", () => {
    const profile = {
      language: "en",
      level: "B1",
      focus: ["articles"],
      levels: { en: { grammar: 3.2, vocab: 3.4, fluency: 3, interaction: 3.5 } },
      levelHistory: { en: [{ at: "2026-09-01T00:00:00.000Z", cefr: "B1", overall: 3.3 }] },
      prefs: { slowSpeech: true },
      errorLog: { en: { tense: { count: 2, lastAt: "2026-09-02T00:00:00.000Z", example: "I goed", correction: "I went" } } },
    };
    const s2 = {
      ...session,
      id: "s2",
      review: undefined,
      judgeUnavailable: "503",
      aids: { suggestions: 1, translations: 0 },
      finalize: { claimedAt: "2026-09-02T00:00:00.000Z", itemsSaved: true, reviewApplied: false, arcAdvanced: false },
      kind: "micro",
      focus: "tense",
    };
    const p = parsePack({ ...valid, arcs: [], profile, sessions: [session, s2], items: [{ ...item, uses: [{ sessionId: "s1", at: "2026-09-02T00:00:00.000Z" }] }] });
    expect(p.profile).toEqual(profile);
    expect(p.sessions[1]).toMatchObject({ judgeUnavailable: "503", aids: { suggestions: 1, translations: 0 }, kind: "micro", focus: "tense" });
    expect(p.sessions[1].finalize).toEqual(s2.finalize);
    expect(p.items[0].uses).toEqual([{ sessionId: "s1", at: "2026-09-02T00:00:00.000Z" }]);
  });

  it("a negative aid count is refused (it would fake「無提示」)", () => {
    expect(() => parsePack({ ...valid, arcs: [], sessions: [{ ...session, aids: { suggestions: -1, translations: 0 } }] })).toThrow(/aids\.suggestions/);
  });

  it("judgeUnavailable is dropped when a review is present (the write paths keep them exclusive)", () => {
    const p = parsePack({ ...valid, arcs: [], sessions: [{ ...session, judgeUnavailable: "stale" }] });
    expect(p.sessions[0].judgeUnavailable).toBeUndefined();
  });

  it("plannedEpisodes is re-clamped to 2..6", () => {
    expect(parsePack({ ...valid, arcs: [{ ...arc, plannedEpisodes: 99 }] }).arcs[0].plannedEpisodes).toBe(6);
    expect(parsePack({ ...valid, arcs: [{ ...arc, plannedEpisodes: 0 }] }).arcs[0].plannedEpisodes).toBe(6);
  });
});

describe("parsePack — older packs without newer fields still read", () => {
  it("accepts a pack with no objectives/arcs lists and a profile with no focus", () => {
    const old = { kind: "learning-pack", exportedAt: "2026-06-01T00:00:00.000Z", profile: { language: "ja", level: "A2" }, scenarios: [scenario], items: [{ ...item, srs: undefined }] };
    const p = parsePack(old);
    expect(p.profile).toEqual({ language: "ja", level: "A2", focus: [] });
    expect(p.objectives).toEqual([]);
    expect(p.arcs).toEqual([]);
    expect(p.items[0].srs).toBeUndefined();
  });

  it("a session without finalize/aids/kind reads as a plain session", () => {
    const p = parsePack({ ...valid, arcs: [] });
    expect(p.sessions[0].finalize).toBeUndefined();
    expect(p.sessions[0].kind).toBeUndefined();
  });

  it("a session without turn flags / structured focus / drilledFocus / recycled reads back without them (unknown, not zero)", () => {
    const p = parsePack({ ...valid, arcs: [] });
    const s = p.sessions[0];
    expect(s.transcript.every((t) => !("echo" in t) && !("aided" in t) && !("l1" in t))).toBe(true);
    expect(s.focus).toBeUndefined();
    expect(s.drilledFocus).toBeUndefined();
    expect(s.recycled).toBeUndefined();
    expect(s.review?.l1Fallbacks).toBeUndefined();
    expect(s.review?.pronunciationNotes).toBeUndefined();
  });

  it("an item without a frame and a profile without accent notes read back without them", () => {
    const p = parsePack({ ...valid, arcs: [], profile: { language: "en", level: "B1", focus: [] } });
    expect(p.items[0].frame).toBeUndefined();
    expect(p.profile?.accentNotes).toBeUndefined();
  });
});

describe("parsePack — Phase D/E fields round-trip and are narrowed", () => {
  it("turn flags survive only as true; a structured focus of each kind, drilledFocus, recycled, review extras, item frame and accent notes round-trip", () => {
    const flagged = { ...session, id: "f", transcript: [{ who: "user", text: "x", echo: true, l1: false }] };
    const focused = {
      ...session,
      id: "g",
      focus: { kind: "gap", gaps: [{ said: "預約", target: "book" }] },
      recycled: ["i1", "i2"],
      review: { ...session.review, l1Fallbacks: [{ said: "預約", target: "book" }], pronunciationNotes: ["th in think"] },
    };
    const micro = { ...session, id: "m", review: undefined, kind: "micro", drilledFocus: { sourceSessionId: "g" } };
    const recurring = { ...session, id: "r", focus: { kind: "recurring", type: "tense", example: "a", correction: "b", sessions: 2 } };
    const p = parsePack({
      ...valid,
      arcs: [],
      profile: { language: "en", level: "B1", focus: [], accentNotes: { en: ["th in think"] } },
      sessions: [flagged, focused, micro, recurring],
      items: [{ ...item, kind: "grammar", frame: "I'd rather ___ than ___" }],
    });
    expect(p.sessions[0].transcript[0]).toEqual({ who: "user", text: "x", echo: true });
    expect(p.sessions[1]).toMatchObject({ focus: { kind: "gap", gaps: [{ said: "預約", target: "book" }] }, recycled: ["i1", "i2"] });
    expect(p.sessions[1].review).toMatchObject({ l1Fallbacks: [{ said: "預約", target: "book" }], pronunciationNotes: ["th in think"] });
    expect(p.sessions[2]).toMatchObject({ kind: "micro", drilledFocus: { sourceSessionId: "g" } });
    expect(p.sessions[3].focus).toEqual({ kind: "recurring", type: "tense", example: "a", correction: "b", sessions: 2 });
    expect(p.items[0].frame).toBe("I'd rather ___ than ___");
    expect(p.profile?.accentNotes).toEqual({ en: ["th in think"] });
  });

  it("refuses a turn flag that is neither true nor false/absent (it would fake「無提示」)", () => {
    expect(() => parsePack({ ...valid, arcs: [], sessions: [{ ...session, transcript: [{ who: "user", text: "x", aided: "yes" }] }] })).toThrow(/aided/);
  });

  it("refuses a focus that pickFocus could never produce: empty gaps, sessions below 2, empty objective", () => {
    const withFocus = (focus: unknown) => () => parsePack({ ...valid, arcs: [], sessions: [{ ...session, focus }] });
    expect(withFocus({ kind: "gap", gaps: [] })).toThrow(/gaps/);
    expect(withFocus({ kind: "recurring", type: "tense", example: "a", correction: "b", sessions: 1 })).toThrow(/sessions/);
    expect(withFocus({ kind: "cando", objective: " " })).toThrow(/objective/);
  });

  it("refuses a focus with an unknown kind or an error type outside the closed set", () => {
    expect(() => parsePack({ ...valid, arcs: [], sessions: [{ ...session, focus: { kind: "vibes" } }] })).toThrow(/focus\.kind/);
    expect(() => parsePack({ ...valid, arcs: [], sessions: [{ ...session, focus: { kind: "meaning", type: "spelling", example: "", correction: "" } }] })).toThrow(/focus\.type/);
  });
});

describe("summariseImport — tells the user adds vs overwrites before writing", () => {
  it("counts by id across scenarios, items, sessions and arcs", () => {
    const p = parsePack(valid);
    const s = summariseImport(p, {
      scenarios: new Set(["sc1"]),
      items: new Set(),
      sessions: new Set(),
      objectives: new Set(),
      arcs: new Set(["arc1"]),
    });
    expect(s).toEqual({ added: 2, overwritten: 2, replacesProfile: false });
  });
});
