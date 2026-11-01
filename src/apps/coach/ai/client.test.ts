import { readFileSync, readdirSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The network boundary: the SDK class itself. Every capability then runs its
// real prompt builder and goes through the real generateJson, so the test sees
// exactly the text the model would receive.
const sent: string[] = [];
vi.mock("@google/genai", async (importOriginal) => {
  const real = await importOriginal<typeof import("@google/genai")>();
  class FakeGenAI {
    models = {
      generateContent: async (req: { contents: string }) => {
        sent.push(req.contents);
        return { text: "{}" };
      },
    };
  }
  return { ...real, GoogleGenAI: FakeGenAI };
});

import { DEFAULT_SCENARIOS } from "../defaults";
import type { Arc, LearnedItem } from "../../../kernel/types";
import { generateArcSeed, generateNextEpisode } from "./arc";
import { ZH_TW_RULE, generateJson } from "./client";
import { generateReviewExtras } from "./extras";
import { extractLearnedItems } from "./items";
import { suggestReplies } from "./replies";
import { summariseSession } from "./review";
import { generateScenario } from "./scenario";
import { translateLine } from "./translate";

const scenario = DEFAULT_SCENARIOS.en[0];
const transcript = [
  { who: "coach" as const, text: "Hi, how was the trip?" },
  { who: "user" as const, text: "It was long but fine, thanks." },
];
const arc: Arc = {
  id: "a1",
  title: "Arc",
  targetLanguage: "en",
  level: "B1",
  premise: "p",
  episodes: [{ n: 1, scenarioId: scenario.id, title: "E1" }],
  plannedEpisodes: 6,
  storyState: { characters: [], events: [], openThreads: [] },
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
const item: LearnedItem = { id: "i", language: "en", kind: "word", text: "deadline", meaning: "截止日", firstSeenAt: "2026-11-01T00:00:00Z" };

// Every text-model capability, called once, keyed by the file that builds its
// prompt. The coverage test below derives the files from the folder, so a new
// capability file that is not listed here fails the suite.
const CAPABILITIES: Record<string, () => Promise<unknown>> = {
  "scenario.ts": () => generateScenario("k", { brief: "b", language: "en", level: "B1" }),
  "arc.ts#seed": () => generateArcSeed("k", { brief: "b", language: "en", level: "B1", episodes: 6 }),
  "arc.ts#next": () =>
    generateNextEpisode("k", { arc, lastEpisode: arc.episodes[0], lastScenario: scenario, transcript }),
  "items.ts": () => extractLearnedItems("k", { scenario, sessionId: "s", transcript }),
  "replies.ts": () => suggestReplies("k", { scenario, transcript }),
  "review.ts": () => summariseSession("k", { transcript, level: "B1" }),
  "translate.ts": () => translateLine("k", "Hello there"),
  "extras.ts": () => generateReviewExtras("k", { item, blank: "____" }),
};

beforeEach(() => {
  sent.length = 0;
});

describe("ZH_TW_RULE — one rule, appended to every text-model prompt", () => {
  it("generateJson sends the caller's prompt followed by the rule", async () => {
    await generateJson("k", "PROMPT BODY", {}, (v) => v).catch(() => undefined);
    expect(sent).toEqual([`PROMPT BODY\n\n${ZH_TW_RULE}`]);
  });

  for (const [name, call] of Object.entries(CAPABILITIES)) {
    it(`${name}: the prompt the model receives ends with ZH_TW_RULE`, async () => {
      await call().catch(() => undefined); // "{}" fails most parsers; only the prompt matters
      expect(sent.length).toBeGreaterThan(0);
      for (const p of sent) expect(p.endsWith(ZH_TW_RULE)).toBe(true);
    });
  }

  it("every file in ai/ that imports generateJson has a capability above", () => {
    const dir = new URL(".", import.meta.url);
    const callers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "client.ts")
      .filter((f) => /import\s*\{[^}]*\bgenerateJson\b[^}]*\}\s*from\s*"\.\/client"/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(callers).toContain("review.ts"); // calls it indirectly (judge.generate ?? generateJson)
    const covered = new Set(Object.keys(CAPABILITIES).map((k) => k.split("#")[0]));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) expect(covered.has(f), f).toBe(true);
  });

  it("names the script, Taiwan usage, and the banned→Taiwan term pairs", () => {
    expect(ZH_TW_RULE).toMatch(/Traditional\s+Chinese/);
    expect(ZH_TW_RULE).toContain("Taiwan");
    for (const pair of ["信息→資訊", "軟件→軟體", "視頻→影片", "質量→品質", "默認→預設", "屏幕→螢幕", "鼠標→滑鼠", "交互→互動", "鏈接→連結", "數據庫→資料庫"]) {
      expect(ZH_TW_RULE).toContain(pair);
    }
    // Japanese text and verbatim quotes of the learner are out of its reach.
    expect(ZH_TW_RULE).toContain("Chinese only");
    expect(ZH_TW_RULE).toContain("VERBATIM stays exactly as written");
  });
});
