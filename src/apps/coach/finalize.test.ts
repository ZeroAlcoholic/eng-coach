import { describe, expect, it, vi } from "vitest";

import type { LearnedItem, LearnerProfile, Scenario, SessionRecord } from "../../kernel/types";
import { DEFAULT_PROFILE } from "../../kernel/types";
import type { JudgeOutcome } from "./ai";
import { finalizeSession, retryReview, type FinalizeDeps } from "./finalize";

// In-memory stand-in for the store slice the pipeline touches. It decides
// nothing; each test scripts the judge/items results by hand.
function memory(seed: { items?: LearnedItem[]; profile?: LearnerProfile; sessions?: SessionRecord[] } = {}) {
  const sessions = new Map<string, SessionRecord>((seed.sessions ?? []).map((s) => [s.id, s]));
  let items: LearnedItem[] = [...(seed.items ?? [])];
  let profile: LearnerProfile = seed.profile ?? { ...DEFAULT_PROFILE };
  const scenarios: Scenario[] = [];
  const ledger: unknown[][] = [];
  let clearDraftCalls = 0;
  const deps: FinalizeDeps = {
    now: () => "2026-09-25T00:00:00.000Z",
    getSession: async (id) => sessions.get(id),
    updateSession: async (id, mutate) => {
      const next = mutate(sessions.get(id));
      if (next) sessions.set(id, next);
      return next;
    },
    clearDraft: async () => {
      clearDraftCalls++;
    },
    listItems: async () => items,
    putItems: async (xs) => {
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const x of xs) byId.set(x.id, x);
      items = [...byId.values()];
    },
    putScenario: async (sc) => {
      scenarios.push(sc);
    },
    getProfile: async () => profile,
    putProfile: async (p) => {
      profile = p;
    },
    recordJudgeOutcomes: async (...args) => {
      ledger.push(args);
    },
    extractItems: vi.fn(async ({ sessionId }) => [item("i-" + Math.random(), sessionId)]),
    judge: vi.fn(async () => review()),
    arc: { getArc: async () => undefined, markEpisodePlayed: async () => {}, advance: async () => {} },
  };
  return {
    deps,
    sessions,
    get items() {
      return items;
    },
    get profile() {
      return profile;
    },
    scenarios,
    ledger,
    get clearDraftCalls() {
      return clearDraftCalls;
    },
  };
}

function item(id: string, sessionId: string): LearnedItem {
  return { id, language: "en", kind: "word", text: "budget", meaning: "預算", firstSeenAt: "2026-09-01T00:00:00.000Z", sourceSessionId: sessionId };
}

function review(): JudgeOutcome {
  return {
    kind: "review",
    samples: 3,
    review: {
      cefr: "B1",
      subscores: { grammar: 3, vocab: 3, fluency: 3, interaction: 3 },
      reviewEn: "ok",
      reviewZh: "好",
      progressNote: "next",
      objectivesMet: [{ objective: "o1", met: true }],
      errors: [{ type: "tense", example: "I goed", correction: "I went" }],
    },
  };
}

const scenario: Scenario = {
  id: "sc1",
  title: "t",
  targetLanguage: "en",
  level: "B1",
  baseContext: "b",
  contentContext: "c",
  coachRole: "r",
  userRole: "u",
  objectives: ["o1"],
  targetPhrases: [],
  progressNote: "old note",
};

const input = {
  scenario,
  profile: { ...DEFAULT_PROFILE, prefs: { slowSpeech: true } },
  sessionId: "s1",
  startedAt: "2026-09-25T00:00:00.000Z",
  transcript: [
    { who: "coach" as const, text: "Hi" },
    { who: "user" as const, text: "I goed to the office" },
  ],
};

describe("finalizeSession — every result lands exactly once", () => {
  it("first run: transcript saved, items saved, review applied, ledger ticked", async () => {
    const m = memory();
    const out = await finalizeSession("k", input, m.deps);
    expect(out.kind).toBe("done");
    const rec = m.sessions.get("s1")!;
    expect(rec.review?.cefr).toBe("B1");
    expect(rec.finalize).toMatchObject({ itemsSaved: true, reviewApplied: true });
    expect(m.items).toHaveLength(1);
    expect(m.scenarios[0].progressNote).toBe("next");
    expect(m.profile.levels?.en?.grammar).toBe(3);
    expect(m.profile.errorLog?.en?.tense?.count).toBe(1);
    expect(m.ledger).toHaveLength(1);
    expect(m.clearDraftCalls).toBe(1);
  });

  it("running it twice for the same session changes nothing the second time", async () => {
    const m = memory();
    await finalizeSession("k", input, m.deps);
    const again = await finalizeSession("k", input, m.deps);
    expect(again.kind).toBe("already");
    expect(m.items).toHaveLength(1);
    expect(m.ledger).toHaveLength(1);
    expect(m.profile.errorLog?.en?.tense?.count).toBe(1);
    expect(m.deps.judge).toHaveBeenCalledTimes(1);
  });

  it("two tabs racing: the second sees the claim and does no analysis", async () => {
    const m = memory();
    // Tab A saved the transcript and claimed, and is mid-judge:
    await m.deps.updateSession("s1", () => ({
      id: "s1",
      scenarioId: "sc1",
      startedAt: input.startedAt,
      transcript: input.transcript,
      finalize: { claimedAt: "2026-09-24T23:55:00.000Z", itemsSaved: false, reviewApplied: false, arcAdvanced: false },
    }));
    // NOTE: the in-memory updateSession is synchronous, so this pins the
    // claimedAt rule, not IndexedDB atomicity (db.updateSession's single
    // read-modify-write transaction carries that).
    const out = await finalizeSession("k", input, m.deps);
    expect(out).toEqual({ kind: "in-progress", claimedAt: "2026-09-24T23:55:00.000Z" });
    expect(m.deps.judge).not.toHaveBeenCalled();
    expect(m.deps.extractItems).not.toHaveBeenCalled();
  });

  it("a claim exactly 10 minutes old is stale and taken over", async () => {
    const m = memory();
    await m.deps.updateSession("s1", () => ({
      id: "s1",
      scenarioId: "sc1",
      startedAt: input.startedAt,
      transcript: input.transcript,
      finalize: { claimedAt: "2026-09-24T23:50:00.000Z", itemsSaved: false, reviewApplied: false, arcAdvanced: false },
    }));
    expect((await finalizeSession("k", input, m.deps)).kind).toBe("done");
  });

  it("a reviewed record from before the ledger existed is left alone", async () => {
    const m = memory();
    await m.deps.updateSession("s1", () => ({
      id: "s1",
      scenarioId: "sc1",
      startedAt: input.startedAt,
      transcript: input.transcript,
      review: review().kind === "review" ? (review() as { review: import("../../kernel/types").SessionReview }).review : undefined,
    }));
    const out = await finalizeSession("k", input, m.deps);
    expect(out.kind).toBe("already");
    expect(m.deps.judge).not.toHaveBeenCalled();
  });

  it("stores the aids record the readouts depend on", async () => {
    const m = memory();
    await finalizeSession("k", { ...input, aids: { suggestions: 2, translations: 0 } }, m.deps);
    expect(m.sessions.get("s1")!.aids).toEqual({ suggestions: 2, translations: 0 });
  });

  it("a results-write failure keeps the review on the record, releases the claim, and a re-run folds once", async () => {
    const m = memory();
    let fail = true;
    const realPut = m.deps.putProfile;
    m.deps.putProfile = async (p) => {
      if (fail) throw new Error("QuotaExceededError");
      return realPut(p);
    };
    await expect(finalizeSession("k", input, m.deps)).rejects.toMatchObject({ name: "ResultsPersistError" });
    const rec = m.sessions.get("s1")!;
    expect(rec.review?.cefr).toBe("B1"); // the truth is on the record
    expect(rec.finalize).toMatchObject({ reviewApplied: false });
    expect(rec.finalize?.claimedAt).toBeUndefined(); // not「in progress」for ten minutes
    fail = false;
    const again = await finalizeSession("k", input, m.deps);
    expect(again.kind).toBe("done");
    expect(m.deps.judge).toHaveBeenCalledTimes(1); // stored review reused, not re-judged
    expect(m.profile.levels?.en?.grammar).toBe(3); // folded exactly once
    expect(m.ledger).toHaveLength(1);
  });

  it("records a use when the learner says an item taught in an earlier session", async () => {
    const m = memory({ items: [{ ...item("taught", "s0"), text: "office" }] });
    await finalizeSession("k", input, m.deps);
    expect(m.items.find((i) => i.id === "taught")!.uses).toEqual([{ sessionId: "s1", at: "2026-09-25T00:00:00.000Z" }]);
  });

  it("a stale claim (tab killed mid-analysis) is taken over", async () => {
    const m = memory();
    await m.deps.updateSession("s1", () => ({
      id: "s1",
      scenarioId: "sc1",
      startedAt: input.startedAt,
      transcript: input.transcript,
      finalize: { claimedAt: "2026-09-24T00:00:00.000Z", itemsSaved: false, reviewApplied: false, arcAdvanced: false },
    }));
    const out = await finalizeSession("k", input, m.deps);
    expect(out.kind).toBe("done");
  });

  it("a clear-draft failure is benign: the record is saved and a recovery re-run is a no-op", async () => {
    const m = memory();
    m.deps.clearDraft = async () => {
      throw new Error("kv locked");
    };
    const first = await finalizeSession("k", input, m.deps);
    expect(first.kind).toBe("done");
    const recovery = await finalizeSession("k", input, m.deps);
    expect(recovery.kind).toBe("already");
    expect(m.items).toHaveLength(1);
  });

  it("items extraction failing alone: review applied, itemsFailed reported, a later run completes items without re-judging", async () => {
    const m = memory();
    (m.deps.extractItems as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    const out = await finalizeSession("k", input, m.deps);
    expect(out).toMatchObject({ kind: "done", items: 0, itemsFailed: true, judge: { kind: "review" } });
    expect(m.sessions.get("s1")!.finalize).toMatchObject({ itemsSaved: false, reviewApplied: true });
    // stale claim → a recovery run may complete the missing step
    m.deps.now = () => "2026-09-25T00:20:00.000Z";
    const again = await finalizeSession("k", input, m.deps);
    expect(again).toMatchObject({ kind: "done", items: 1, itemsFailed: false });
    expect(m.deps.judge).toHaveBeenCalledTimes(1); // stored review reused
    expect(m.ledger).toHaveLength(1); // review not applied twice
    expect(m.sessions.get("s1")!.finalize).toMatchObject({ itemsSaved: true, reviewApplied: true });
  });

  it("retryReview also saves the items a first run failed to extract", async () => {
    const m = memory();
    (m.deps.extractItems as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    await finalizeSession("k", input, m.deps);
    expect(m.items).toHaveLength(0);
    await retryReview("k", { session: m.sessions.get("s1")!, scenario, profile: input.profile }, m.deps);
    expect(m.items).toHaveLength(1);
    expect(m.deps.judge).toHaveBeenCalledTimes(1);
  });

  it("items already stored for this session (old run without ledger) are not duplicated", async () => {
    const m = memory({ items: [item("old", "s1")] });
    await finalizeSession("k", input, m.deps);
    expect(m.items.filter((i) => i.sourceSessionId === "s1")).toHaveLength(1);
  });

  it("the profile is re-read before the fold: another tab's level change survives, Practice's prefs win", async () => {
    const m = memory({ profile: { ...DEFAULT_PROFILE, level: "C1", prefs: { showLevelMeter: true } } });
    await finalizeSession("k", input, m.deps);
    expect(m.profile.level).toBe("C1");
    expect(m.profile.prefs).toEqual({ showLevelMeter: true, slowSpeech: true });
  });
});

describe("finalizeSession — an unavailable judge writes no numbers", () => {
  const unavailable: JudgeOutcome = { kind: "unavailable", reason: "沒有有效樣本" };

  it("stores the transcript and the reason; scenario note, profile and ledger untouched", async () => {
    const m = memory();
    (m.deps.judge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(unavailable);
    const out = await finalizeSession("k", input, m.deps);
    expect(out).toMatchObject({ kind: "done", judge: { kind: "unavailable" } });
    const rec = m.sessions.get("s1")!;
    expect(rec.review).toBeUndefined();
    expect(rec.judgeUnavailable).toBe("沒有有效樣本");
    expect(rec.finalize?.reviewApplied).toBe(false);
    expect(m.scenarios).toHaveLength(0);
    expect(m.profile.levels).toBeUndefined();
    expect(m.ledger).toHaveLength(0);
    expect(m.items).toHaveLength(1); // items are independent of the judge
  });

  it("a judge that throws is reported as unavailable, not as a fake review", async () => {
    const m = memory();
    (m.deps.judge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));
    const out = await finalizeSession("k", input, m.deps);
    expect(out).toMatchObject({ kind: "done", judge: { kind: "unavailable", reason: "503" } });
    expect(m.sessions.get("s1")!.review).toBeUndefined();
  });

  it("a coach-only transcript never calls the judge and stores no review", async () => {
    const m = memory();
    m.deps.judge = vi.fn(async () => unavailable);
    const out = await finalizeSession("k", { ...input, transcript: [{ who: "coach", text: "Hello?" }] }, m.deps);
    expect(out).toMatchObject({ kind: "done", judge: { kind: "unavailable" } });
    expect(m.sessions.get("s1")!.review).toBeUndefined();
  });

  it("retryReview re-reads the record: a review that landed meanwhile is not folded again", async () => {
    const m = memory();
    (m.deps.judge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(unavailable);
    await finalizeSession("k", input, m.deps);
    const stale = m.sessions.get("s1")!; // the row HistorySheet loaded
    // another tab retried and succeeded in the meantime
    await retryReview("k", { session: stale, scenario, profile: input.profile }, m.deps);
    const foldsBefore = m.ledger.length;
    await retryReview("k", { session: stale, scenario, profile: input.profile }, m.deps);
    expect(m.ledger).toHaveLength(foldsBefore);
    expect(m.deps.judge).toHaveBeenCalledTimes(2); // first run + one retry, not two retries
  });

  it("retryReview later applies the review once and clears the reason", async () => {
    const m = memory();
    (m.deps.judge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(unavailable);
    await finalizeSession("k", input, m.deps);
    const judge = await retryReview("k", { session: m.sessions.get("s1")!, scenario, profile: input.profile }, m.deps);
    expect(judge.kind).toBe("review");
    const rec = m.sessions.get("s1")!;
    expect(rec.review?.cefr).toBe("B1");
    expect(rec.judgeUnavailable).toBeUndefined();
    expect(m.ledger).toHaveLength(1);
    // and a full re-run afterwards is a no-op
    expect((await finalizeSession("k", input, m.deps)).kind).toBe("already");
    expect(m.ledger).toHaveLength(1);
  });
});

describe("finalizeSession — micro sessions", () => {
  it("saves the transcript with kind micro; no judge, no items, no level — but chunk uses are recorded", async () => {
    const m = memory({ items: [{ ...item("taught", "s0"), text: "office" }] });
    const out = await finalizeSession("k", { ...input, sessionId: "m1", kind: "micro", focus: "past tense" }, m.deps);
    expect(out).toEqual({ kind: "micro" });
    expect(m.sessions.get("m1")).toMatchObject({ kind: "micro", focus: "past tense" });
    expect(m.deps.judge).not.toHaveBeenCalled();
    expect(m.deps.extractItems).not.toHaveBeenCalled();
    expect(m.profile.levels).toBeUndefined();
    expect(m.items[0].uses).toEqual([{ sessionId: "m1", at: "2026-09-25T00:00:00.000Z" }]);
  });
});
