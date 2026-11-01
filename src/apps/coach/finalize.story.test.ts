import { describe, expect, it, vi } from "vitest";

// The store is the boundary for advanceArc's dedupe check below; finalize's own
// dependencies are injected per test.
const db = vi.hoisted(() => ({
  getArc: vi.fn(),
  getScenario: vi.fn(),
  listSessionsFor: vi.fn(async () => []),
  putArcWithScenario: vi.fn(async () => {}),
  updateArc: vi.fn(async () => {}),
}));
vi.mock("../../kernel/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import type { Arc, Scenario, SessionRecord } from "../../kernel/types";
import { DEFAULT_PROFILE } from "../../kernel/types";
import { advanceArc } from "./arcs";
import { finalizeSession, type FinalizeDeps } from "./finalize";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const episodeScenario: Scenario = {
  id: "ep1",
  title: "第一集",
  targetLanguage: "en",
  level: "B1",
  baseContext: "b",
  contentContext: "c",
  coachRole: "r",
  userRole: "u",
  objectives: ["能說明狀況"],
  targetPhrases: [],
  arc: { arcId: "a1", episode: 1 },
};
const arcWith = (completedAt?: string): Arc => ({
  id: "a1",
  title: "A",
  targetLanguage: "en",
  level: "B1",
  premise: "p",
  episodes: [{ n: 1, scenarioId: "ep1", title: "第一集", canDoIds: ["cd1"], ...(completedAt ? { completedAt } : {}) }],
  plannedEpisodes: 6,
  storyState: { characters: [], events: [], openThreads: [] },
  canDos: [{ id: "cd1", text: "能說明狀況" }],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

function harness(advance: () => Promise<unknown>, arc: Arc = arcWith()) {
  const sessions = new Map<string, SessionRecord>();
  const ledger: unknown[] = [];
  const deps: FinalizeDeps = {
    now: () => "2026-11-02T00:00:00.000Z",
    getSession: async (id) => sessions.get(id),
    updateSession: async (id, mutate) => {
      const next = mutate(sessions.get(id));
      if (next) sessions.set(id, next);
      return next;
    },
    clearDraft: async () => {},
    listItems: async () => [],
    putItems: async () => {},
    putScenario: async () => {},
    getProfile: async () => ({ ...DEFAULT_PROFILE }),
    putProfile: async () => {},
    recordJudgeOutcomes: async (...args) => {
      ledger.push(args);
    },
    extractItems: async () => [],
    judge: async () => ({
      kind: "review",
      samples: 1,
      review: {
        cefr: "B1",
        subscores: { grammar: 3, vocab: 3, fluency: 3, interaction: 3 },
        reviewEn: "ok",
        reviewZh: "不錯喔",
        progressNote: "n",
        objectivesMet: [{ objective: "能說明狀況", met: true }],
        errors: [],
      },
    }),
    arc: { getArc: async () => arc, markEpisodePlayed: async () => {}, advance },
  };
  const input = {
    scenario: episodeScenario,
    profile: { ...DEFAULT_PROFILE },
    sessionId: "s1",
    startedAt: "2026-11-02T00:00:00.000Z",
    transcript: [
      { who: "coach" as const, text: "Hi" },
      { who: "user" as const, text: "My flight was cancelled and I need a new one." },
    ],
  };
  return { deps, input, sessions, ledger };
}

describe("finalize — the next episode is written in the background (U4)", () => {
  it("finalize returns while the generation is still running; the ledger ticks only once it settles", async () => {
    const gen = deferred();
    const h = harness(() => gen.promise);
    const out = await finalizeSession("k", h.input, h.deps);
    expect(out.kind).toBe("done");
    if (out.kind === "done") expect(out.story).toEqual({ played: true, advanced: "pending" });
    await flush();
    expect(h.sessions.get("s1")?.finalize?.arcAdvanced).toBe(false); // still generating
    gen.resolve();
    await flush();
    await flush();
    expect(h.sessions.get("s1")?.finalize?.arcAdvanced).toBe(true);
  });

  it("a failed generation does not touch the outcome and throws nowhere", async () => {
    const gen = deferred();
    const h = harness(() => gen.promise);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await finalizeSession("k", h.input, h.deps);
    gen.reject(new Error("quota"));
    await flush();
    await flush();
    expect(out.kind).toBe("done");
    if (out.kind === "done") {
      expect(out.story).toEqual({ played: true, advanced: "pending" });
      expect(out.judge.kind).toBe("review");
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("next episode not written yet"), expect.any(Error));
    warn.mockRestore();
  });

  it("the episode could not be marked played → the ledger is not ticked (下一集 may replay it, and says so)", async () => {
    const h = harness(async () => {});
    h.deps.arc.markEpisodePlayed = async () => {
      throw new Error("store busy");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await finalizeSession("k", h.input, h.deps);
    await flush();
    await flush();
    if (out.kind === "done") expect(out.story).toEqual({ played: false, advanced: "pending" });
    expect(h.sessions.get("s1")?.finalize?.arcAdvanced).toBe(false);
    warn.mockRestore();
  });

  it("a recovery re-run (episode already marked played) does not count the can-do verdicts twice", async () => {
    const first = harness(async () => {});
    await finalizeSession("k", first.input, first.deps);
    expect(first.ledger).toHaveLength(1 + 1); // scenario objectives + the arc's can-do ledger

    const rerun = harness(async () => {}, arcWith("2026-11-02T00:00:00.000Z"));
    await finalizeSession("k", rerun.input, rerun.deps);
    expect(rerun.ledger).toHaveLength(1); // scenario objectives only
  });
});

describe("advanceArc — two taps on 下一集 share one generation (U4)", () => {
  it("generate is called once for concurrent advances of the same arc", async () => {
    const arc = arcWith("2026-11-02T00:00:00.000Z");
    db.getArc.mockResolvedValue(arc);
    db.getScenario.mockResolvedValue(episodeScenario);
    const gen = deferred<Awaited<ReturnType<Parameters<typeof advanceArc>[1]>>>();
    const generate = vi.fn(() => gen.promise);
    const a = advanceArc("a1", generate);
    const b = advanceArc("a1", generate);
    expect(a).toBe(b);
    await flush();
    gen.resolve({
      storyState: { characters: [], events: [], openThreads: [] },
      episode: {
        title: "第二集",
        contentContext: "c2",
        coachRole: "r",
        userRole: "u",
        objectives: [],
        targetPhrases: [],
        recap: "",
        canDoIndexes: [],
      },
    });
    await Promise.all([a, b]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
