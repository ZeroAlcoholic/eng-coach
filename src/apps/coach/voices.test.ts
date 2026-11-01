import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VOICE_POOLS, pickVoice, voiceSeed } from "./voices";
import type { Scenario } from "../../kernel/types";

describe("pickVoice — the same story keeps the same voice (I2)", () => {
  it("the same seed gives the same voice, 100 times", () => {
    for (const lang of ["en", "ja"] as const) {
      const first = pickVoice(lang, "arc-london");
      for (let i = 0; i < 100; i++) expect(pickVoice(lang, "arc-london")).toBe(first);
    }
  });

  it("100 different seeds reach every voice in the pool", () => {
    for (const lang of ["en", "ja"] as const) {
      const seen = new Set(Array.from({ length: 100 }, (_, i) => pickVoice(lang, `scenario-${i}`)));
      expect([...seen].sort()).toEqual([...VOICE_POOLS[lang]].sort());
    }
  });

  it("an empty seed takes the first voice", () => {
    expect(pickVoice("en", "")).toBe(VOICE_POOLS.en[0]);
    expect(pickVoice("ja", "")).toBe(VOICE_POOLS.ja[0]);
  });

  it("the seed is the arc id for an episode, the scenario id otherwise", () => {
    const base = { id: "sc-1" } as Scenario;
    expect(voiceSeed(base)).toBe("sc-1");
    expect(voiceSeed({ ...base, arc: { arcId: "arc-9", episode: 3 } })).toBe("arc-9");
  });

  it("is the standard FNV-1a: a fixed seed maps to a fixed voice on any run or device", () => {
    // FNV-1a("a") = 0xe40c292c = 3826002220; 3826002220 % 6 = 4.
    expect(VOICE_POOLS.en.length).toBe(6);
    expect(pickVoice("en", "a")).toBe(VOICE_POOLS.en[4]);
  });

  it("Practice seeds the voice from voiceSeed(scenario)", () => {
    const src = readFileSync(new URL("./Practice.tsx", import.meta.url), "utf8");
    expect(src).toContain("pickVoice(scenario.targetLanguage, voiceSeed(scenario))");
  });

  it("voices.ts no longer draws at random", () => {
    const src = readFileSync(new URL("./voices.ts", import.meta.url), "utf8");
    expect(src).not.toContain("Math.random");
  });
});
