import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePack } from "../../kernel/packSchema";
import { livePrefs, turnCueOn } from "./livePrefs";

const pack = (prefs?: object) => ({
  version: 1,
  kind: "learning-pack",
  exportedAt: "2026-11-01T00:00:00.000Z",
  scenarios: [],
  items: [],
  sessions: [],
  profile: { language: "en", level: "B1", focus: [], ...(prefs ? { prefs } : {}) },
});

describe("prefs.turnCue (C1)", () => {
  it("absent = on; only an explicit false turns it off", () => {
    expect(turnCueOn(undefined)).toBe(true);
    expect(turnCueOn({})).toBe(true);
    expect(turnCueOn({ turnCue: true })).toBe(true);
    expect(turnCueOn({ turnCue: false })).toBe(false);
  });

  it("an untouched pref is not written; a toggled one is", () => {
    const base = { slowSpeech: false, showLevelMeter: false, taskCardOpen: undefined };
    expect(livePrefs({ ...base, turnCue: undefined })).not.toHaveProperty("turnCue");
    expect(livePrefs({ ...base, turnCue: false })).toEqual({ slowSpeech: false, showLevelMeter: false, turnCue: false });
  });

  it("round-trips through a pack; an old pack reads back without it (= on)", () => {
    expect(parsePack(pack({ turnCue: false })).profile?.prefs).toEqual({ turnCue: false });
    const old = parsePack(pack({ slowSpeech: true })).profile;
    expect(old?.prefs).toEqual({ slowSpeech: true });
    expect(turnCueOn(old?.prefs)).toBe(true);
    expect(() => parsePack(pack({ turnCue: "on" }))).toThrow("turnCue");
  });

  it("Practice hands the pref to the session before it starts, and the 🔔 toggle saves it", () => {
    const src = readFileSync(new URL("./Practice.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/session\(\)\.setTurnCue\(turnCue\);\s*\/\/[^\n]*\n\s*await session\(\)\.start\(spec\)/);
    expect(src).toContain("savePrefs({ turnCue: next })");
  });
});
