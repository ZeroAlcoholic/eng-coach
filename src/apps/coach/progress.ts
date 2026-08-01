// Pure progress/ability maths — kept side-effect-free so it is unit-testable and
// reusable. Covers W1 (per-skill EWMA memory), W2 (median of judge samples), W3
// (measured ability → coach communication policy), and W6 (level summary/trend).

import { ERROR_TYPES } from "../../kernel/types";
import type {
  CEFRLevel,
  ErrorTally,
  ErrorType,
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

/** Per-skill subscore (1–6) → CEFR band label for DISPLAY: unlike numToCefr it
 *  does not clamp — a missing/zero subscore reads as "—", not "A1". */
export function band(n: number): string {
  return CEFR_ORDER[n - 1] ?? "—";
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
  return { ...base, cefr, subscores, errors: voteErrors(reviews) };
}

// E1 — noise control for typed errors. A single sample naming an error type is
// not evidence: the judge is a probabilistic reader of a noisy transcript, and one
// spurious "article" would enter the running tally forever. So a type must appear
// in a MAJORITY of the samples (≥2) to survive, and with fewer than two samples to
// compare, nothing does. The example/correction come from the first sample that
// named it, so the learner sees their own words rather than a merged paraphrase.
const MIN_ERROR_VOTES = 2;

export function voteErrors(reviews: SessionReview[]): SessionReview["errors"] {
  if (reviews.length < MIN_ERROR_VOTES) return [];
  const votes = new Map<ErrorType, { n: number; first: NonNullable<SessionReview["errors"]>[number] }>();
  for (const review of reviews) {
    // One vote per type PER SAMPLE — a sample listing "tense" twice must not
    // out-vote the other samples on its own.
    const seen = new Set<ErrorType>();
    for (const e of review.errors ?? []) {
      if (!isErrorType(e?.type) || seen.has(e.type)) continue;
      seen.add(e.type);
      const prev = votes.get(e.type);
      if (prev) prev.n += 1;
      else votes.set(e.type, { n: 1, first: e });
    }
  }
  return [...votes.values()].filter((v) => v.n >= MIN_ERROR_VOTES).map((v) => v.first);
}

const ERROR_TYPE_SET = new Set<string>(ERROR_TYPES);

/** Guard the closed set: a model can return a plausible label outside the enum. */
export function isErrorType(v: unknown): v is ErrorType {
  return typeof v === "string" && ERROR_TYPE_SET.has(v);
}

// E1 — fold one session's confirmed errors into the per-language running tally.
// `count` counts SESSIONS, not occurrences: three article slips in one session are
// one data point about a habit, and counting occurrences would let a single bad
// session dominate the tally for months.
export function applyErrorsToProfile(
  profile: LearnerProfile,
  language: TargetLanguage,
  errors: SessionReview["errors"],
  nowIso: string,
): LearnerProfile {
  // Dedupe by type FIRST, so this holds its own invariant (one session = at most
  // one increment per type) no matter what the caller passes. voteErrors already
  // dedupes, but a stored recap from before E1's vote existed might not.
  const confirmed = new Map(
    (errors ?? []).filter((e) => isErrorType(e?.type)).map((e) => [e.type, e]),
  );
  if (!confirmed.size) return profile;
  const forLang: Partial<Record<ErrorType, ErrorTally>> = { ...profile.errorLog?.[language] };
  for (const e of confirmed.values()) {
    const prev = forLang[e.type];
    forLang[e.type] = {
      count: (prev?.count ?? 0) + 1,
      lastAt: nowIso,
      example: e.example?.trim() || prev?.example,
      correction: e.correction?.trim() || prev?.correction,
    };
  }
  return { ...profile, errorLog: { ...profile.errorLog, [language]: forLang } };
}

/** E1 — the error types worth naming to the coach: most frequent first. Requires
 *  at least two sessions of evidence, so a one-off never becomes "recurring". */
export function recurringErrors(
  profile: LearnerProfile,
  language: TargetLanguage,
  limit = 3,
): { type: ErrorType; tally: ErrorTally }[] {
  return Object.entries(profile.errorLog?.[language] ?? {})
    .filter((entry): entry is [ErrorType, ErrorTally] => isErrorType(entry[0]) && !!entry[1])
    .filter(([, tally]) => tally.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit)
    .map(([type, tally]) => ({ type, tally }));
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
