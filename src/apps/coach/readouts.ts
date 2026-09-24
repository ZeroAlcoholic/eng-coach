// Three progress readouts for Home, computed from stored records with zero API
// calls, each traceable to the sessions it was computed from.
//
//   unaidedCanDo   — of the can-do verdicts the judge gave in sessions where the
//                    learner used no help (no「卡住?」, no tap-to-translate), the
//                    share graded "met". Sessions without an `aids` record (older
//                    builds) are excluded rather than assumed unaided.
//   chunkUse       — of the items taught in an earlier session, the share the
//                    learner has since PRODUCED in their own turns (see uses.ts).
//   errorRecurrence— of the error types the judge confirmed in the window, the
//                    share that recurred in two or more sessions. Lower is better.
//
// A readout is null when its denominator is empty: no number is better than a
// number made of nothing. Trend compares the recent half of the window with
// the earlier half and only speaks when both halves have data.

import type { LearnedItem, Scenario, SessionRecord, TargetLanguage } from "../../kernel/types";

export type Trend = "up" | "flat" | "down";

export interface Readout {
  value: number | null; // 0..1
  n: number; // denominator
  trend: Trend | null;
  betterWhen: "high" | "low";
  sourceSessionIds: string[]; // what to open when the learner taps the line
}

export interface Readouts {
  unaidedCanDo: Readout;
  chunkUse: Readout;
  errorRecurrence: Readout;
}

export const READOUT_WINDOW = 10; // judged sessions considered

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
  return s.aids.suggestions + s.aids.translations > 0;
}

/** Judged, non-micro sessions of one language, oldest → newest, last `window`. */
export function judgedSessions(
  sessions: SessionRecord[],
  scenarios: Scenario[],
  language: TargetLanguage,
  window = READOUT_WINDOW,
): SessionRecord[] {
  const langOf = new Map(scenarios.map((sc) => [sc.id, sc.targetLanguage]));
  return sessions
    .filter((s) => s.kind !== "micro" && !!s.review && langOf.get(s.scenarioId) === language)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-window);
}

function canDoRate(sessions: SessionRecord[]): { value: number | null; n: number; ids: string[] } {
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
  return { value: ratio(met, total), n: total, ids };
}

function recurrenceRate(sessions: SessionRecord[]): { value: number | null; n: number; ids: string[] } {
  const seenIn = new Map<string, Set<string>>(); // error type → session ids
  for (const s of sessions) {
    for (const e of s.review?.errors ?? []) {
      if (!seenIn.has(e.type)) seenIn.set(e.type, new Set());
      seenIn.get(e.type)!.add(s.id);
    }
  }
  const types = [...seenIn.values()];
  const recurring = types.filter((ids) => ids.size >= 2);
  const ids = new Set<string>();
  for (const set of recurring) for (const id of set) ids.add(id);
  return { value: ratio(recurring.length, types.length), n: types.length, ids: [...ids] };
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
  const judged = judgedSessions(input.sessions, input.scenarios, input.language, input.window);
  const [earlier, recent] = halves(judged);

  const canDo = canDoRate(judged);
  const recur = recurrenceRate(judged);

  // Chunk use: an item has had a chance to be used only if at least one session
  // of its language started after it was taught.
  const langSessions = input.sessions
    .filter((s) => new Map(input.scenarios.map((sc) => [sc.id, sc.targetLanguage])).get(s.scenarioId) === input.language)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const latestStart = langSessions.at(-1)?.startedAt ?? "";
  const taught = input.items.filter((it) => it.language === input.language && it.firstSeenAt < latestStart);
  const used = taught.filter((it) => (it.uses?.length ?? 0) > 0);
  const useIds = new Set<string>();
  for (const it of used) for (const u of it.uses ?? []) useIds.add(u.sessionId);

  return {
    unaidedCanDo: {
      value: canDo.value,
      n: canDo.n,
      trend: earlier.length >= 2 && recent.length >= 2 ? trendOf(canDoRate(earlier).value, canDoRate(recent).value) : null,
      betterWhen: "high",
      sourceSessionIds: canDo.ids,
    },
    chunkUse: {
      value: ratio(used.length, taught.length),
      n: taught.length,
      trend: null, // items taught earlier have had more chances; halves would not be comparable
      betterWhen: "high",
      sourceSessionIds: [...useIds],
    },
    errorRecurrence: {
      value: recur.value,
      n: recur.n,
      trend: earlier.length >= 2 && recent.length >= 2 ? trendOf(recurrenceRate(earlier).value, recurrenceRate(recent).value) : null,
      betterWhen: "low",
      sourceSessionIds: recur.ids,
    },
  };
}
