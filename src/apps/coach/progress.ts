// Pure progress/ability maths — kept side-effect-free so it is unit-testable and
// reusable. Covers W1 (per-skill EWMA memory), W2 (median of judge samples), W3
// (measured ability → coach communication policy), and W6 (level summary/trend).

import type {
  CEFRLevel,
  LearnerProfile,
  SessionReview,
  SkillLevels,
  SkillScores,
  TargetLanguage,
} from "../../kernel/types";

const CEFR_ORDER: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** CEFR letter → 1–6 (unknown → B1=3). */
export function cefrToNum(c: string): number {
  const i = CEFR_ORDER.indexOf(c as CEFRLevel);
  return i >= 0 ? i + 1 : 3;
}
/** 1–6 (float, clamped/rounded) → CEFR letter. */
export function numToCefr(n: number): CEFRLevel {
  return CEFR_ORDER[Math.min(5, Math.max(0, Math.round(n) - 1))];
}

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// W2 — combine self-consistency samples: median the numeric fields, keep the
// prose from the first sample (text fields don't average).
export function medianReview(reviews: SessionReview[]): SessionReview {
  const base = reviews[0];
  const cefr = numToCefr(median(reviews.map((r) => cefrToNum(r.cefr))));
  const subs = reviews.map((r) => r.subscores).filter((s): s is SkillScores => !!s);
  const subscores: SkillScores | undefined = subs.length
    ? {
        grammar: Math.round(median(subs.map((s) => s.grammar))),
        vocab: Math.round(median(subs.map((s) => s.vocab))),
        fluency: Math.round(median(subs.map((s) => s.fluency))),
        interaction: Math.round(median(subs.map((s) => s.interaction))),
      }
    : base.subscores;
  return { ...base, cefr, subscores };
}

const EWMA_ALPHA = 0.25; // weight on the newest session; rest is history
const ewma = (prev: number, next: number) => EWMA_ALPHA * next + (1 - EWMA_ALPHA) * prev;
const overallOf = (l: SkillLevels) => (l.grammar + l.vocab + l.fluency + l.interaction) / 4;

// W1 — fold this session's subscores into the remembered per-language levels.
// Never overwrites wholesale; seeds on first observation; caps history at 30.
export function applySessionToProfile(
  profile: LearnerProfile,
  review: SessionReview,
  nowIso: string,
): LearnerProfile {
  const subs = review.subscores;
  if (!subs) return profile; // nothing numeric to learn from
  const lang = profile.language;
  const prev = profile.levels?.[lang];
  const next: SkillLevels = prev
    ? {
        grammar: ewma(prev.grammar, subs.grammar),
        vocab: ewma(prev.vocab, subs.vocab),
        fluency: ewma(prev.fluency, subs.fluency),
        interaction: ewma(prev.interaction, subs.interaction),
      }
    : { ...subs };
  const overall = overallOf(next);
  const entry = { at: nowIso, cefr: review.cefr || numToCefr(overall), overall };
  const hist = [...(profile.levelHistory?.[lang] ?? []), entry].slice(-30);
  return {
    ...profile,
    levels: { ...profile.levels, [lang]: next },
    levelHistory: { ...profile.levelHistory, [lang]: hist },
  };
}

export interface LevelSummary {
  band: CEFRLevel;
  trend: "up" | "flat" | "down";
  sessions: number;
}

// W6 — current overall band + trend for the active language (null if no data).
export function levelSummary(profile: LearnerProfile, lang: TargetLanguage): LevelSummary | null {
  const lv = profile.levels?.[lang];
  if (!lv) return null;
  const hist = profile.levelHistory?.[lang] ?? [];
  let trend: LevelSummary["trend"] = "flat";
  if (hist.length >= 2) {
    const recent = hist[hist.length - 1].overall;
    const before = hist[Math.max(0, hist.length - 4)].overall;
    trend = recent - before > 0.15 ? "up" : recent - before < -0.15 ? "down" : "flat";
  }
  return { band: numToCefr(overallOf(lv)), trend, sessions: hist.length };
}

export interface CoachPolicy {
  l1: "high" | "medium" | "low" | "minimal";
  speed: "slow" | "natural";
  correction: "explicit" | "prompt" | "recast";
  scaffold: "model" | "elicit" | "extend";
}

// W3 — measured ability for the SCENARIO's language (else its fixed level) →
// communication mode. Expertise-reversal: correction lightens + scaffolding
// fades as level rises. Keyed by the language being practised, not the toggle.
export function coachPolicy(
  profile: LearnerProfile,
  lang: TargetLanguage,
  scenarioLevelNum: number,
): CoachPolicy {
  const lv = profile.levels?.[lang];
  const overall = lv ? overallOf(lv) : scenarioLevelNum; // 1–6
  if (overall < 2.5) return { l1: "high", speed: "slow", correction: "explicit", scaffold: "model" };
  if (overall < 3.5) return { l1: "medium", speed: "slow", correction: "prompt", scaffold: "elicit" };
  if (overall < 4.5) return { l1: "low", speed: "natural", correction: "prompt", scaffold: "elicit" };
  return { l1: "minimal", speed: "natural", correction: "recast", scaffold: "extend" };
}
