// Three progress readouts for Home, computed from stored records with zero API
// calls, each traceable to the sessions it was computed from.
//
//   unaidedCanDo    — of the can-do verdicts the judge gave in sessions where
//                     the learner used no help (no「卡住?」, no tap-to-translate,
//                     no spoken help request), the share graded "met". Sessions
//                     without an `aids` record (older builds) are excluded rather
//                     than assumed unaided.
//   chunkUse        — of the due items the coach was asked to recycle in the
//                     window's sessions, the share the learner then PRODUCED in
//                     that session (uses.ts, own production only). Sessions
//                     without a `recycled` record are excluded, not assumed.
//   focusResolution — of the error-type focuses shown at the end of the
//                     window's sessions, the share that did not appear again in
//                     the two full sessions that followed. Split by whether the
//                     learner drilled it in a micro session. Counted by session
//                     order only — never by days, gaps or how often they practise.
//
// A readout is null when its denominator is empty: no number is better than a
// number made of nothing. Trend compares the recent half of the window with
// the earlier half and only speaks when both halves have data.

import type { LearnedItem, Scenario, SessionRecord, TargetLanguage } from "../../kernel/types";
import { structuredFocus } from "./focus";

export type Trend = "up" | "flat" | "down";

export interface ReadoutPart {
  value: number | null; // 0..1
  n: number; // denominator
  sourceSessionIds: string[]; // what to open when the learner taps the line
}

export interface Readout extends ReadoutPart {
  trend: Trend | null;
  betterWhen: "high" | "low";
}

export interface FocusReadout extends Readout {
  drilled: ReadoutPart; // focuses followed by a micro session
  undrilled: ReadoutPart; // focuses the learner skipped
}

export interface Readouts {
  unaidedCanDo: Readout;
  chunkUse: Readout;
  focusResolution: FocusReadout;
}

export const READOUT_WINDOW = 10; // judged sessions considered
// A focus is judged resolved or not by this many full sessions after it.
export const FOCUS_FOLLOW_UP = 2;

const TREND_DELTA = 0.1;

function trendOf(earlier: number | null, recent: number | null): Trend | null {
  if (earlier === null || recent === null) return null;
  if (recent - earlier > TREND_DELTA) return "up";
  if (earlier - recent > TREND_DELTA) return "down";
  return "flat";
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function aidsUsed(s: SessionRecord): boolean | null {
  if (!s.aids) return null; // unknown — the session predates aid tracking
  return s.aids.suggestions + s.aids.translations > 0 || s.transcript.some((t) => t.aided === true);
}

function languageOf(scenarios: Scenario[]): (s: SessionRecord) => TargetLanguage | undefined {
  const langOf = new Map(scenarios.map((sc) => [sc.id, sc.targetLanguage]));
  return (s) => langOf.get(s.scenarioId);
}

/** Judged, non-micro sessions of one language, oldest → newest, last `window`. */
export function judgedSessions(
  sessions: SessionRecord[],
  scenarios: Scenario[],
  language: TargetLanguage,
  window = READOUT_WINDOW,
): SessionRecord[] {
  return allJudged(sessions, scenarios, language).slice(-window);
}

function allJudged(sessions: SessionRecord[], scenarios: Scenario[], language: TargetLanguage): SessionRecord[] {
  const lang = languageOf(scenarios);
  return sessions
    .filter((s) => s.kind !== "micro" && !!s.review && lang(s) === language)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

function canDoRate(sessions: SessionRecord[]): ReadoutPart {
  let met = 0;
  let total = 0;
  const ids: string[] = [];
  for (const s of sessions) {
    if (aidsUsed(s) !== false) continue; // aided, or unknown
    const verdicts = s.review?.objectivesMet ?? [];
    if (!verdicts.length) continue;
    ids.push(s.id);
    total += verdicts.length;
    met += verdicts.filter((v) => v.met).length;
  }
  return { value: ratio(met, total), n: total, sourceSessionIds: ids };
}

function chunkUseRate(sessions: SessionRecord[], items: LearnedItem[]): ReadoutPart {
  const byId = new Map(items.map((it) => [it.id, it]));
  let produced = 0;
  let offered = 0;
  const ids: string[] = [];
  for (const s of sessions) {
    if (!s.recycled?.length) continue; // unknown (older record) or nothing due
    offered += s.recycled.length;
    const used = s.recycled.filter((id) => byId.get(id)?.uses?.some((u) => u.sessionId === s.id)).length;
    produced += used;
    if (used > 0) ids.push(s.id);
  }
  return { value: ratio(produced, offered), n: offered, sourceSessionIds: ids };
}

interface FocusOutcome {
  sessionId: string;
  resolved: boolean;
  drilled: boolean;
}

/** For each session with an error-type focus and enough follow-up, whether the
 *  type stayed away. `later` is every full judged session after `s`, in order. */
function focusOutcomes(sessions: SessionRecord[], all: SessionRecord[], micros: SessionRecord[]): FocusOutcome[] {
  const drilledFrom = new Set(micros.map((m) => m.drilledFocus?.sourceSessionId).filter((id): id is string => !!id));
  const out: FocusOutcome[] = [];
  for (const s of sessions) {
    const focus = structuredFocus(s.focus);
    if (!focus || (focus.kind !== "meaning" && focus.kind !== "recurring")) continue;
    const at = all.findIndex((x) => x.id === s.id);
    const later = all.slice(at + 1, at + 1 + FOCUS_FOLLOW_UP);
    if (later.length < FOCUS_FOLLOW_UP) continue; // not enough follow-up yet: unknown
    const recurred = later.some((x) => x.review?.errors?.some((e) => e.type === focus.type));
    out.push({ sessionId: s.id, resolved: !recurred, drilled: drilledFrom.has(s.id) });
  }
  return out;
}

function part(outcomes: FocusOutcome[]): ReadoutPart {
  return {
    value: ratio(outcomes.filter((o) => o.resolved).length, outcomes.length),
    n: outcomes.length,
    sourceSessionIds: outcomes.map((o) => o.sessionId),
  };
}

function halves<T>(xs: T[]): [T[], T[]] {
  const mid = Math.floor(xs.length / 2);
  return [xs.slice(0, mid), xs.slice(mid)];
}

export function computeReadouts(input: {
  sessions: SessionRecord[];
  items: LearnedItem[];
  scenarios: Scenario[];
  language: TargetLanguage;
  window?: number;
}): Readouts {
  const all = allJudged(input.sessions, input.scenarios, input.language);
  const judged = all.slice(-(input.window ?? READOUT_WINDOW));
  const [earlier, recent] = halves(judged);
  const enoughForTrend = earlier.length >= 2 && recent.length >= 2;
  const lang = languageOf(input.scenarios);
  const micros = input.sessions.filter((s) => s.kind === "micro" && lang(s) === input.language);

  const canDo = canDoRate(judged);
  const chunk = chunkUseRate(judged, input.items);
  const outcomes = focusOutcomes(judged, all, micros);
  const focus = part(outcomes);

  return {
    unaidedCanDo: {
      ...canDo,
      trend: enoughForTrend ? trendOf(canDoRate(earlier).value, canDoRate(recent).value) : null,
      betterWhen: "high",
    },
    chunkUse: {
      ...chunk,
      trend: enoughForTrend ? trendOf(chunkUseRate(earlier, input.items).value, chunkUseRate(recent, input.items).value) : null,
      betterWhen: "high",
    },
    focusResolution: {
      ...focus,
      trend: enoughForTrend
        ? trendOf(part(focusOutcomes(earlier, all, micros)).value, part(focusOutcomes(recent, all, micros)).value)
        : null,
      betterWhen: "high",
      drilled: part(outcomes.filter((o) => o.drilled)),
      undrilled: part(outcomes.filter((o) => !o.drilled)),
    },
  };
}
