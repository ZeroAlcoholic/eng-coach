// S4 — the built-in demo arcs are AUTHORED data, so nothing at runtime validates
// them. These tests are that validation: a typo'd canDoIndexes or an outline that
// doesn't match plannedEpisodes would otherwise ship a demo arc that silently
// loses its syllabus or drifts off its designed shape.

import { describe, expect, it } from "vitest";

import { TARGET_LANGUAGES, DEFAULT_ARC_LENGTH } from "../../kernel/types";
import { DEFAULT_ARCS } from "./arcDefaults";
import { countSentences, freezeCanDos, resolveCanDoIds } from "./arcs";

const all = Object.values(DEFAULT_ARCS).flat();

describe("DEFAULT_ARCS — one demo story line per language", () => {
  it("ships exactly one arc for every target language", () => {
    for (const { id } of TARGET_LANGUAGES) expect(DEFAULT_ARCS[id]).toHaveLength(1);
  });

  it("uses unique, stable ids and tags each arc with its own language", () => {
    const ids = all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [lang, arcs] of Object.entries(DEFAULT_ARCS))
      for (const a of arcs) expect(a.targetLanguage).toBe(lang);
  });
});

describe.each(all.map((a) => [a.id, a] as const))("%s", (_id, demo) => {
  it("runs at most the default arc length, with one outline beat per episode", () => {
    expect(demo.plannedEpisodes).toBeLessThanOrEqual(DEFAULT_ARC_LENGTH);
    expect(demo.outline).toHaveLength(demo.plannedEpisodes);
    for (const beat of demo.outline) expect(beat.trim().length).toBeGreaterThan(0);
  });

  it("binds 6–8 distinct can-dos (ROADMAP S3)", () => {
    expect(demo.canDos.length).toBeGreaterThanOrEqual(6);
    expect(demo.canDos.length).toBeLessThanOrEqual(8);
    expect(new Set(demo.canDos).size).toBe(demo.canDos.length);
    // Every one must survive freezing — a blank or duplicate would shrink the
    // syllabus below the 6 the arc claims to teach.
    expect(freezeCanDos(demo.canDos)).toHaveLength(demo.canDos.length);
  });

  it("targets 1–2 REAL can-dos in episode 1", () => {
    const frozen = freezeCanDos(demo.canDos);
    const ids = resolveCanDoIds(frozen, demo.episode1.canDoIndexes);
    expect(demo.episode1.canDoIndexes.length).toBeGreaterThanOrEqual(1);
    expect(ids.length).toBe(demo.episode1.canDoIndexes.length); // none dropped as invalid
  });

  it("authors episode 1 completely, so installing needs no model call", () => {
    const e = demo.episode1;
    for (const field of ["title", "contentContext", "coachRole", "userRole", "recap"] as const)
      expect(e[field].trim().length).toBeGreaterThan(0);
    expect(e.objectives.length).toBeGreaterThanOrEqual(3);
    expect(e.targetPhrases.length).toBeGreaterThanOrEqual(5);
    expect(demo.premise.trim().length).toBeGreaterThan(0);
  });

  it("keeps episode 1's recap within the ≤3 sentence opening budget (S2b)", () => {
    expect(countSentences(demo.episode1.recap)).toBeLessThanOrEqual(3);
  });

  // 全域規則：繁中內容永久禁止簡體字。These arcs are hand-authored prose, so a
  // stray simplified character has nothing else to catch it.
  it("contains no simplified-only Chinese characters", () => {
    const SIMPLIFIED_ONLY =
      "盘个东们说过还这来时对国动务够无为写师买话记华门产电业发风气长开关闭见观点热让认识计设语讲课题练习价钱边远进达运车轮传统结构续级红绿蓝黑体验据么儿实现场问题师约图书馆办";
    const prose = [
      demo.title,
      demo.premise,
      ...demo.canDos,
      ...demo.outline,
      ...demo.storyState.characters.flatMap((c) => [c.name, c.note]),
      ...demo.storyState.openThreads,
      demo.episode1.title,
      demo.episode1.contentContext,
      demo.episode1.coachRole,
      demo.episode1.userRole,
      demo.episode1.recap,
      ...demo.episode1.objectives,
    ].join("\n");
    const found = [...new Set(prose)].filter((ch) => SIMPLIFIED_ONLY.includes(ch));
    expect(found).toEqual([]);
  });

  it("seeds a shared story state with cast and open threads but no events yet", () => {
    expect(demo.storyState.characters.length).toBeGreaterThanOrEqual(1);
    expect(demo.storyState.openThreads.length).toBeGreaterThanOrEqual(1);
    expect(demo.storyState.events).toEqual([]); // nothing has happened before episode 1
  });
});
