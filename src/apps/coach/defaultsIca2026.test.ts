import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE } from "../../kernel/types";
import { DEFAULT_SCENARIOS } from "./defaults";
import { ICA2026_SCENARIOS } from "./defaultsIca2026";
import { EN_CLOSING_CHECK, EN_CONGRESS_FRAME, FRAME_PRESETS, JA_CLOSING_CHECK, JA_CONGRESS_FRAME } from "./frames";
import { composeSystemInstruction } from "./prompt";

// A phrase that carries a figure ("a 55.8% win rate") asks the learner to
// recall the talk's numbers; the congress set is a discussion, so phrases
// carry none. Spelled-out logistics ("fifteen minutes") are fine.
const hasFigure = (t: string) => /[0-9０-９]|%/.test(t);
// A phrase the learner is to say back must fit one breath at B1.
const MAX_WORDS = 15;
const words = (t: string) => t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

// An opinion line with no side ("Personally, I think the human part matters")
// fits the counterpart's mouth just as well, so the counterpart may say it
// first; naming the learner's side (we / our / us / my) keeps it the learner's line.
const OPINION_MARK = /\b(?:I think|personally|I see it|I feel|I believe)\b/i;
const SIDE = /\b(?:we|we're|our|ours|us|my)\b/i;
const sidelessOpinion = (t: string) => OPINION_MARK.test(t) && !SIDE.test(t);

const all = [...ICA2026_SCENARIOS.en, ...ICA2026_SCENARIOS.ja];

describe("ICA 2026 scenarios are discussions, not recall tests", () => {
  it("ship inside the built-in lists, each once", () => {
    for (const lang of ["en", "ja"] as const) {
      for (const s of ICA2026_SCENARIOS[lang]) expect(DEFAULT_SCENARIOS[lang].filter((d) => d.id === s.id), s.id).toHaveLength(1);
    }
  });

  it("run in discussion mode on the congress frame of their own language", () => {
    for (const s of all) expect(s.mode, s.id).toBe("discussion");
    for (const s of ICA2026_SCENARIOS.en) expect(s.baseContext, s.id).toBe(EN_CONGRESS_FRAME);
    for (const s of ICA2026_SCENARIOS.ja) expect(s.baseContext, s.id).toBe(JA_CONGRESS_FRAME);
  });

  it("the congress frames drop the presets' 'say the phrases in your own turns' and keep the closing check", () => {
    const recycleEn = "phrases naturally in your own turns";
    const recycleJa = "自分のセリフにも自然に織り込んで";
    expect(FRAME_PRESETS.en).toContain(recycleEn); // the check bites on the preset
    expect(FRAME_PRESETS.ja).toContain(recycleJa);
    expect(EN_CONGRESS_FRAME).not.toContain(recycleEn);
    expect(JA_CONGRESS_FRAME).not.toContain(recycleJa);
    for (const f of [FRAME_PRESETS.en, EN_CONGRESS_FRAME]) expect(f.endsWith(EN_CLOSING_CHECK)).toBe(true);
    for (const f of [FRAME_PRESETS.ja, JA_CONGRESS_FRAME]) expect(f.endsWith(JA_CLOSING_CHECK)).toBe(true);
    expect("Keep it warm.".endsWith(EN_CLOSING_CHECK)).toBe(false); // the check bites
  });

  it("every English congress scene's instruction keeps the coach in role; other English scenes do not get the rule", () => {
    const role = "never speak as the learner's character";
    for (const s of ICA2026_SCENARIOS.en) expect(composeSystemInstruction(s, DEFAULT_PROFILE), s.id).toContain(role);
    const others = DEFAULT_SCENARIOS.en.filter((d) => !ICA2026_SCENARIOS.en.some((s) => s.id === d.id));
    expect(others.length).toBeGreaterThan(0);
    for (const s of others) expect(composeSystemInstruction(s, DEFAULT_PROFILE), s.id).not.toContain(role);
  });

  it("target phrases carry no figures", () => {
    expect(hasFigure("One setting had a 55.8% win rate.")).toBe(true); // the check bites
    expect(hasFigure("We now have fifteen minutes.")).toBe(false);
    for (const s of all) for (const p of s.targetPhrases) expect(hasFigure(p), `${s.id}: ${p}`).toBe(false);
  });

  it("an English opinion line names the learner's side", () => {
    expect(sidelessOpinion("Personally, I think the human part of the job matters even more now.")).toBe(true); // the check bites
    expect(sidelessOpinion("For our agents, the human part of the job matters even more now.")).toBe(false);
    expect(sidelessOpinion("The model doesn't decide anything.")).toBe(false);
    for (const s of ICA2026_SCENARIOS.en) for (const p of s.targetPhrases) expect(sidelessOpinion(p), `${s.id}: ${p}`).toBe(false);
  });

  it(`English target phrases are at most ${MAX_WORDS} words`, () => {
    expect(words("Most of our AI tools turned out to be low risk, so we can focus on the few that matter.")).toBeGreaterThan(MAX_WORDS);
    expect(words("Most of our tools are low risk, so we focus on the few that matter.")).toBeLessThanOrEqual(MAX_WORDS);
    for (const s of ICA2026_SCENARIOS.en) for (const p of s.targetPhrases) expect(words(p), `${s.id}: ${p}`).toBeLessThanOrEqual(MAX_WORDS);
  });
});
