import { describe, expect, it } from "vitest";

import type { Arc, ArcEpisode } from "../../kernel/types";
import {
  clampRecap,
  countSentences,
  episodeCanDos,
  freezeCanDos,
  hasFullSyllabus,
  isArcFinished,
  nextEpisodeNumber,
  normaliseStoryState,
  pendingEpisode,
  playedCount,
  resolveCanDoIds,
} from "./arcs";

const arc = (episodes: ArcEpisode[], plannedEpisodes = 6): Arc => ({
  id: "a1",
  title: "出差線",
  targetLanguage: "en",
  level: "B1",
  premise: "一趟倫敦出差",
  episodes,
  plannedEpisodes,
  storyState: { characters: [], events: [], openThreads: [] },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const ep = (n: number, completed?: string): ArcEpisode => ({
  n,
  scenarioId: `s${n}`,
  title: `第 ${n} 集`,
  ...(completed ? { completedAt: completed } : {}),
});

describe("arc selectors", () => {
  it("treats the first un-played episode as 下一集", () => {
    const a = arc([ep(1, "2026-08-01T01:00:00Z"), ep(2)]);
    expect(pendingEpisode(a)?.n).toBe(2);
    expect(nextEpisodeNumber(a)).toBe(2);
    expect(playedCount(a)).toBe(1);
    expect(isArcFinished(a)).toBe(false);
  });

  it("reports the NEXT number when every materialised episode is played", () => {
    const a = arc([ep(1, "x"), ep(2, "y")]);
    expect(pendingEpisode(a)).toBeUndefined();
    expect(nextEpisodeNumber(a)).toBe(3); // one needs generating
    expect(isArcFinished(a)).toBe(false);
  });

  it("is finished only when all planned episodes are played", () => {
    const done = arc([ep(1, "x"), ep(2, "y")], 2);
    expect(isArcFinished(done)).toBe(true);
    // A pending final episode is NOT finished — it's still there to play.
    expect(isArcFinished(arc([ep(1, "x"), ep(2)], 2))).toBe(false);
  });
});

describe("clampRecap — S2's ≤3 sentence guard is enforced in code", () => {
  it("keeps at most three sentences of Chinese prose", () => {
    const four = "第一句。第二句。第三句。第四句。";
    expect(clampRecap(four)).toBe("第一句。第二句。第三句。");
    expect(countSentences(clampRecap(four))).toBe(3);
  });

  it("counts ASCII and full-width terminators alike, and flattens newlines", () => {
    expect(countSentences("A? B! C.")).toBe(3);
    expect(clampRecap("一。\n二！\n三？\n四。")).toBe("一。二！三？");
  });

  it("keeps a shorter recap untouched and survives a missing one", () => {
    expect(clampRecap("只有一句話。")).toBe("只有一句話。");
    expect(clampRecap("")).toBe("");
    expect(clampRecap(undefined as unknown as string)).toBe("");
  });

  it("keeps an unterminated final sentence rather than dropping it", () => {
    expect(clampRecap("第一句。沒有句號結尾")).toBe("第一句。沒有句號結尾");
  });
});

describe("freezeCanDos — S3's syllabus is fixed at creation", () => {
  it("assigns stable positional ids and preserves the text verbatim", () => {
    const out = freezeCanDos(["能問路", "能點餐"]);
    expect(out).toEqual([
      { id: "cd1", text: "能問路" },
      { id: "cd2", text: "能點餐" },
    ]);
  });

  it("dedupes and drops empties so a repeat can't occupy two syllabus slots", () => {
    expect(freezeCanDos(["能問路", " 能問路 ", "", "  ", "能點餐"])).toEqual([
      { id: "cd1", text: "能問路" },
      { id: "cd2", text: "能點餐" },
    ]);
  });

  it("caps at 8 and returns undefined when there is nothing usable", () => {
    expect(freezeCanDos(Array.from({ length: 12 }, (_, i) => `能做事 ${i}`))).toHaveLength(8);
    expect(freezeCanDos([])).toBeUndefined();
    expect(freezeCanDos(undefined)).toBeUndefined();
  });

  it("hasFullSyllabus accepts 6–8 only", () => {
    const withN = (n: number) =>
      ({ ...arc([]), canDos: freezeCanDos(Array.from({ length: n }, (_, i) => `能 ${i}`)) }) as Arc;
    expect(hasFullSyllabus(withN(5))).toBe(false);
    expect(hasFullSyllabus(withN(6))).toBe(true);
    expect(hasFullSyllabus(withN(8))).toBe(true);
    expect(hasFullSyllabus(withN(9))).toBe(true); // freezeCanDos already capped it to 8
    expect(hasFullSyllabus(arc([]))).toBe(false); // no syllabus at all
  });
});

describe("resolveCanDoIds — the model may only PICK from the frozen list", () => {
  const canDos = freezeCanDos(["a", "b", "c"]);

  it("maps 1-based positions to ids", () => {
    expect(resolveCanDoIds(canDos, [1, 3])).toEqual(["cd1", "cd3"]);
  });

  it("drops out-of-range, duplicate and non-numeric picks instead of inventing", () => {
    expect(resolveCanDoIds(canDos, [0, 4, 99, -1, "x", null])).toEqual([]);
    expect(resolveCanDoIds(canDos, [2, 2])).toEqual(["cd2"]);
    expect(resolveCanDoIds(canDos, ["2", 3.7])).toEqual(["cd2", "cd3"]);
  });

  it("never returns more than two per episode", () => {
    expect(resolveCanDoIds(canDos, [1, 2, 3])).toEqual(["cd1", "cd2"]);
  });

  it("returns nothing when there is no syllabus or no picks", () => {
    expect(resolveCanDoIds(undefined, [1])).toEqual([]);
    expect(resolveCanDoIds(canDos, undefined)).toEqual([]);
  });
});

describe("episodeCanDos — resolving an episode's syllabus slice", () => {
  const withSyllabus: Arc = { ...arc([]), canDos: freezeCanDos(["能問路", "能點餐"]) };

  it("returns the referenced can-dos in the episode's order", () => {
    const e: ArcEpisode = { ...ep(1), canDoIds: ["cd2", "cd1"] };
    expect(episodeCanDos(withSyllabus, e).map((c) => c.text)).toEqual(["能點餐", "能問路"]);
  });

  it("silently skips ids the syllabus no longer contains, and handles absences", () => {
    expect(episodeCanDos(withSyllabus, { ...ep(1), canDoIds: ["cd9"] })).toEqual([]);
    expect(episodeCanDos(withSyllabus, ep(1))).toEqual([]);
    expect(episodeCanDos(withSyllabus, undefined)).toEqual([]);
    expect(episodeCanDos(arc([]), { ...ep(1), canDoIds: ["cd1"] })).toEqual([]);
  });
});

describe("normaliseStoryState — model output is untrusted and must stay bounded", () => {
  it("drops empties, flattens whitespace and keeps the NEWEST events", () => {
    const state = normaliseStoryState({
      characters: [{ name: " Maya ", note: "客戶\n聯絡人" }, { name: "", note: "無名" }],
      events: Array.from({ length: 25 }, (_, i) => `事件${i + 1}`),
      openThreads: ["  ", "還沒簽約"],
    });
    expect(state.characters).toEqual([{ name: "Maya", note: "客戶 聯絡人" }]);
    expect(state.events).toHaveLength(20);
    expect(state.events[0]).toBe("事件6"); // oldest trimmed, recent continuity kept
    expect(state.events.at(-1)).toBe("事件25");
    expect(state.openThreads).toEqual(["還沒簽約"]);
  });

  it("caps the cast and the open threads", () => {
    const state = normaliseStoryState({
      characters: Array.from({ length: 12 }, (_, i) => ({ name: `N${i}`, note: "x" })),
      events: [],
      openThreads: Array.from({ length: 9 }, (_, i) => `t${i}`),
    });
    expect(state.characters).toHaveLength(8);
    expect(state.openThreads).toHaveLength(5);
  });

  it("returns an empty state for missing/garbage input rather than throwing", () => {
    expect(normaliseStoryState(undefined)).toEqual({
      characters: [],
      events: [],
      openThreads: [],
    });
  });
});
