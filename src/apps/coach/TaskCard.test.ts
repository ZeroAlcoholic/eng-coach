import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { parsePack } from "../../kernel/packSchema";
import { TaskCard, livePrefs, taskCardExpanded, toggledTaskCardPref } from "./TaskCard";

const full = {
  title: "預算會議",
  coachRole: "Mia Chen, CFO",
  userRole: "專案經理",
  objectives: ["說明超支原因", "提出兩個方案", "爭取延期", "確認下一步", "約下次會議"],
  targetPhrases: ["circle back", "on track", "push back", "ballpark"],
};
const html = (s: typeof full, expanded = true) =>
  renderToStaticMarkup(createElement(TaskCard, { scenario: s, expanded, onToggle: () => undefined }));

describe("TaskCard — the three data shapes (I3)", () => {
  it("repeated objectives render without colliding", () => {
    const out = html({ ...full, objectives: ["說明", "說明"] });
    expect(out.match(/<li>說明<\/li>/g)).toHaveLength(2);
  });

  it("full: roles, the first three objectives + 還有 N 項, the first three phrases", () => {
    const out = html(full);
    expect(out).toContain("你扮演：專案經理");
    expect(out).toContain("對方：Mia Chen, CFO");
    for (const o of full.objectives.slice(0, 3)) expect(out).toContain(o);
    expect(out).not.toContain("確認下一步");
    expect(out).toContain("還有 2 項");
    for (const p of full.targetPhrases.slice(0, 3)) expect(out).toContain(p);
    expect(out).not.toContain("ballpark");
  });

  it("empty objectives: no 這場要做到 block, phrases still shown", () => {
    const out = html({ ...full, objectives: [] });
    expect(out).not.toContain("這場要做到");
    expect(out).not.toContain("還有");
    expect(out).toContain("可以用的句子");
  });

  it("empty phrases: no 可以用的句子 block, objectives still shown", () => {
    const out = html({ ...full, targetPhrases: [] });
    expect(out).not.toContain("可以用的句子");
    expect(out).toContain("這場要做到");
  });

  it("three or fewer objectives: no 還有 line", () => {
    expect(html({ ...full, objectives: full.objectives.slice(0, 3) })).not.toContain("還有");
  });

  it("collapsed: one row with the first objective and an expand control", () => {
    const out = html(full, false);
    expect(out).toContain("📋 任務：說明超支原因");
    expect(out).toContain("展開");
    expect(out).not.toContain("你扮演");
    expect(html({ ...full, objectives: [] }, false)).toContain("📋 任務：預算會議");
  });
});

describe("taskCardExpanded", () => {
  it("open before the session whatever the pref; live, open only when the pref says so", () => {
    expect(taskCardExpanded(false, undefined)).toBe(true);
    expect(taskCardExpanded(false, false)).toBe(true);
    expect(taskCardExpanded(true, undefined)).toBe(false); // absent pref = folded live
    expect(taskCardExpanded(true, false)).toBe(false);
    expect(taskCardExpanded(true, true)).toBe(true);
  });
});

describe("prefs.taskCardOpen — the live fold is remembered", () => {
  it("one tap opens a folded card and folds an open one", () => {
    expect(toggledTaskCardPref(undefined)).toBe(true);
    expect(toggledTaskCardPref(true)).toBe(false);
    expect(toggledTaskCardPref(false)).toBe(true);
  });

  it("the written prefs carry the choice; untouched, the key stays absent", () => {
    expect(livePrefs({ slowSpeech: true, showLevelMeter: false, taskCardOpen: true })).toEqual({
      slowSpeech: true,
      showLevelMeter: false,
      taskCardOpen: true,
    });
    expect(livePrefs({ slowSpeech: false, showLevelMeter: false, taskCardOpen: undefined })).not.toHaveProperty("taskCardOpen");
  });

  it("Practice writes prefs from one ref that every toggle updates (the cutoff's stale closure reads it too)", () => {
    const src = readFileSync(new URL("./Practice.tsx", import.meta.url), "utf8");
    expect(src).toContain("savePrefs({ taskCardOpen: next })");
    expect(src).toContain("prefsRef.current = { ...prefsRef.current, ...next };");
    expect(src.match(/prefs: \{ \.\.\.profile\.prefs, \.\.\.prefsRef\.current \}/g)).toHaveLength(2);
  });

  const pack = (prefs?: object) => ({
    version: 1,
    kind: "learning-pack",
    exportedAt: "2026-11-01T00:00:00.000Z",
    scenarios: [],
    items: [],
    sessions: [],
    profile: { language: "en", level: "B1", focus: [], ...(prefs ? { prefs } : {}) },
  });

  it("round-trips through a pack; an old pack without it reads back without it", () => {
    expect(parsePack(pack({ slowSpeech: true, taskCardOpen: true })).profile?.prefs).toEqual({ slowSpeech: true, taskCardOpen: true });
    expect(parsePack(pack({ slowSpeech: true })).profile?.prefs).toEqual({ slowSpeech: true });
    expect(() => parsePack(pack({ taskCardOpen: "yes" }))).toThrow("taskCardOpen");
  });
});
