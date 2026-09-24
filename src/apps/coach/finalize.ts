// Shared end-of-session pipeline. Order and guarantees:
//   1. the transcript is saved FIRST (local, cheap — a later AI failure never
//      loses it) and the crash-recovery draft cleared;
//   2. the session is CLAIMED, so a second runner (draft recovery in another
//      tab, a double tap) sees the claim and does nothing;
//   3. the judge and item extraction run; the results are applied step by step
//      and each step is ticked off on the session's FinalizeLedger, so a re-run
//      after a partial failure applies only what is missing;
//   4. a judge that produced no valid sample leaves the session WITHOUT a review
//      (and with the reason) — never with numbers standing in for a measurement.
//
// Used from Practice (normal「停止並儲存」), Home (recovering a draft) and
// HistorySheet (retrying an unavailable review). Everything it touches is
// injected through FinalizeDeps so the pipeline is testable without IndexedDB.

import * as db from "../../kernel/db";
import type { LearnedItem, LearnerProfile, Scenario, SessionRecord, SessionReview, TranscriptTurn } from "../../kernel/types";
import { extractLearnedItems, summariseSession, type JudgeOutcome } from "./ai";
import { advanceArc, episodeCanDos, markEpisodePlayed, nextEpisodeGenerator } from "./arcs";
import { canonicalizeVerdicts, recordJudgeOutcomes } from "./objectives";
import { applyErrorsToProfile, applySessionToProfile } from "./progress";
import { recordItemUses } from "./uses";

export type FinalizeOutcome =
  // This run did the analysis. `judge` says whether a review exists.
  | { kind: "done"; items: number; judge: JudgeOutcome }
  // Another run (an earlier finalize, or one in flight in another tab) owns this
  // session; nothing was changed. `review` is whatever is already stored.
  | { kind: "already"; review?: SessionReview }
  // A micro session: transcript saved, no judge, no items, no level fold.
  | { kind: "micro" };

/** The LOCAL transcript write failed — nothing is saved and the draft (if any)
 *  is still in place. Callers must message this opposite to an AI failure:
 *  "not saved, don't leave" vs "saved, analysis failed, safe to leave". */
export class PersistError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PersistError";
  }
}

/** The transcript is saved AND the analysis succeeded, but writing the RESULTS
 *  (items / progress note / recap / level fold) failed partway. Carries the
 *  computed outcome so callers can still SHOW the recap and tell the truth:
 *  "analysis done, but some results may not be stored". */
export class ResultsPersistError extends Error {
  constructor(
    cause: unknown,
    public readonly outcome: FinalizeOutcome,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ResultsPersistError";
  }
}

export interface FinalizeInput {
  scenario: Scenario;
  profile: LearnerProfile; // only its `prefs` are trusted — the rest is re-read fresh
  sessionId: string;
  startedAt: string;
  transcript: TranscriptTurn[];
  aids?: SessionRecord["aids"];
  kind?: "micro";
  focus?: string;
}

/** Everything the pipeline touches, so tests can run it against memory. */
export interface FinalizeDeps {
  now: () => string;
  getSession: typeof db.getSession;
  updateSession: typeof db.updateSession;
  clearDraft: () => Promise<unknown>;
  listItems: typeof db.listItems;
  putItems: typeof db.putItems;
  putScenario: (sc: Scenario) => Promise<unknown>;
  getProfile: typeof db.getProfile;
  putProfile: (p: LearnerProfile) => Promise<unknown>;
  recordJudgeOutcomes: typeof recordJudgeOutcomes;
  extractItems: (input: { scenario: Scenario; sessionId: string; transcript: TranscriptTurn[] }) => Promise<LearnedItem[]>;
  judge: (input: {
    transcript: TranscriptTurn[];
    level: Scenario["level"];
    previous?: string;
    objectives?: string[];
  }) => Promise<JudgeOutcome>;
  arc: {
    getArc: typeof db.getArc;
    markEpisodePlayed: typeof markEpisodePlayed;
    advance: (arcId: string) => Promise<unknown>;
  };
}

export function defaultDeps(apiKey: string): FinalizeDeps {
  return {
    now: () => new Date().toISOString(),
    getSession: db.getSession,
    updateSession: db.updateSession,
    clearDraft: db.clearDraft,
    listItems: db.listItems,
    putItems: db.putItems,
    putScenario: db.putScenario,
    getProfile: db.getProfile,
    putProfile: db.putProfile,
    recordJudgeOutcomes,
    extractItems: (input) => extractLearnedItems(apiKey, input),
    judge: (input) => summariseSession(apiKey, input),
    arc: {
      getArc: db.getArc,
      markEpisodePlayed,
      advance: (arcId) => advanceArc(arcId, nextEpisodeGenerator(apiKey)),
    },
  };
}

// A claim older than this is presumed dead (a tab killed mid-analysis) and may
// be taken over. Long enough for three judge samples on a slow network.
const CLAIM_TTL_MS = 10 * 60 * 1000;

const EMPTY_LEDGER = { itemsSaved: false, reviewApplied: false, arcAdvanced: false };

export async function finalizeSession(
  apiKey: string,
  input: FinalizeInput,
  deps: FinalizeDeps = defaultDeps(apiKey),
): Promise<FinalizeOutcome> {
  const { scenario, transcript, sessionId } = input;
  const now = deps.now();

  // 1. Transcript first. An existing record (a previous run got this far) is
  //    kept as-is — its ledger says what still needs doing.
  try {
    await deps.updateSession(sessionId, (existing) =>
      existing ?? {
        id: sessionId,
        scenarioId: scenario.id,
        startedAt: input.startedAt,
        transcript,
        ...(input.aids ? { aids: input.aids } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.focus ? { focus: input.focus } : {}),
        finalize: { ...EMPTY_LEDGER },
      },
    );
  } catch (err) {
    throw new PersistError(err); // transcript NOT saved; draft survives
  }
  // The saved record supersedes the draft. A failed clear is benign — recovery
  // re-runs this pipeline, which the claim below makes a no-op.
  await deps.clearDraft().catch(() => {});

  if (input.kind === "micro") return { kind: "micro" };
  if (!transcript.length) {
    await tick(deps, sessionId, { reviewApplied: true, itemsSaved: true });
    return { kind: "done", items: 0, judge: { kind: "unavailable", reason: "沒有對話內容。" } };
  }

  // 2. Claim. Exactly one runner proceeds past this line per session.
  const claimed = await claim(deps, sessionId, now);
  if (!claimed) {
    const stored = await deps.getSession(sessionId);
    return { kind: "already", review: stored?.review };
  }
  const ledger = { ...EMPTY_LEDGER, ...(claimed.finalize ?? {}) };

  // 3. Analysis. Items and judge are independent; one failing must not void the other.
  const [itemsResult, judgeResult] = await Promise.allSettled([
    ledger.itemsSaved
      ? Promise.resolve<LearnedItem[]>([])
      : deps.extractItems({ scenario, sessionId, transcript }),
    ledger.reviewApplied && claimed.review
      ? Promise.resolve<JudgeOutcome>({ kind: "review", review: claimed.review, samples: 0 })
      : deps.judge({
          transcript,
          level: scenario.level,
          previous: scenario.progressNote,
          objectives: scenario.objectives,
        }),
  ]);
  const items = itemsResult.status === "fulfilled" ? itemsResult.value : [];
  const judge: JudgeOutcome =
    judgeResult.status === "fulfilled"
      ? judgeResult.value
      : { kind: "unavailable", reason: describe(judgeResult.reason) };
  const outcome: FinalizeOutcome = { kind: "done", items: items.length, judge };

  // 4. Apply, ticking the ledger after each step so a re-run skips what landed.
  try {
    if (!ledger.itemsSaved && itemsResult.status === "fulfilled") {
      await saveItemsOnce(deps, sessionId, items);
      await tick(deps, sessionId, { itemsSaved: true });
    }
    if (!ledger.reviewApplied) {
      if (judge.kind === "review") {
        await applyReview(deps, input, judge.review, now);
        await tick(deps, sessionId, { reviewApplied: true }, (rec) => ({ ...rec, review: judge.review, judgeUnavailable: undefined }));
      } else {
        await tick(deps, sessionId, {}, (rec) => ({ ...rec, judgeUnavailable: judge.reason }));
      }
    }
    // Chunk-use tracking is derived data: best-effort, after the load-bearing writes.
    await recordItemUses(deps, sessionId, transcript, scenario.targetLanguage, now).catch(() => {});
  } catch (err) {
    // Storage died mid-pipeline (e.g. quota). The analysis itself succeeded —
    // a plain throw would be reported as "analysis failed", which is false.
    throw new ResultsPersistError(err, outcome);
  }

  // 5. Story arc. Best-effort and AFTER the ResultsPersistError boundary: the
  //    recap, items and level are stored; a failed generation must leave the arc
  //    byte-identical so「下一集」simply retries.
  if (scenario.arc && !ledger.arcAdvanced) {
    await advanceStory(deps, scenario, judge.kind === "review" ? judge.review : undefined);
    await tick(deps, sessionId, { arcAdvanced: true }).catch(() => {});
  }
  return outcome;
}

/** HistorySheet: run the judge again for a stored session that has no review.
 *  Same apply step as a first run; the claim window is bypassed on purpose
 *  because the user is asking for exactly this. */
export async function retryReview(
  apiKey: string,
  input: { session: SessionRecord; scenario: Scenario; profile: LearnerProfile },
  deps: FinalizeDeps = defaultDeps(apiKey),
): Promise<JudgeOutcome> {
  const { session, scenario } = input;
  if (session.review) return { kind: "review", review: session.review, samples: 0 };
  const judge = await deps.judge({
    transcript: session.transcript,
    level: scenario.level,
    previous: scenario.progressNote,
    objectives: scenario.objectives,
  });
  if (judge.kind === "review") {
    const now = deps.now();
    await applyReview(deps, { scenario, profile: input.profile }, judge.review, now);
    await tick(deps, session.id, { reviewApplied: true }, (rec) => ({ ...rec, review: judge.review, judgeUnavailable: undefined }));
  } else {
    await tick(deps, session.id, {}, (rec) => ({ ...rec, judgeUnavailable: judge.reason }));
  }
  return judge;
}

// --- steps ------------------------------------------------------------------

async function claim(deps: FinalizeDeps, sessionId: string, now: string): Promise<SessionRecord | null> {
  let taken: SessionRecord | null = null;
  await deps.updateSession(sessionId, (rec) => {
    if (!rec) return undefined;
    const ledger = rec.finalize;
    // A record from before the ledger existed with a review = fully done.
    if (ledger?.reviewApplied || (!ledger && rec.review)) return undefined;
    if (ledger?.claimedAt && Date.parse(now) - Date.parse(ledger.claimedAt) < CLAIM_TTL_MS) return undefined;
    taken = { ...rec, finalize: { ...EMPTY_LEDGER, ...ledger, claimedAt: now } };
    return taken;
  });
  return taken;
}

async function tick(
  deps: FinalizeDeps,
  sessionId: string,
  step: Partial<Omit<SessionRecord["finalize"] & object, "claimedAt">>,
  also: (rec: SessionRecord) => SessionRecord = (r) => r,
): Promise<void> {
  await deps.updateSession(sessionId, (rec) =>
    rec ? also({ ...rec, finalize: { ...EMPTY_LEDGER, ...rec.finalize, ...step } }) : undefined,
  );
}

/** Items carry `sourceSessionId`; if any already exist for this session, a
 *  previous run saved them and these are duplicates with fresh UUIDs. */
async function saveItemsOnce(deps: FinalizeDeps, sessionId: string, items: LearnedItem[]): Promise<void> {
  if (!items.length) return;
  const existing = await deps.listItems();
  if (existing.some((i) => i.sourceSessionId === sessionId)) return;
  await deps.putItems(items);
}

async function applyReview(
  deps: FinalizeDeps,
  input: Pick<FinalizeInput, "scenario" | "profile">,
  review: SessionReview,
  now: string,
): Promise<void> {
  const { scenario } = input;
  await deps.putScenario({ ...scenario, progressNote: review.progressNote || scenario.progressNote });
  // Read the profile FRESH: the one passed in is Practice's snapshot from
  // session start, and another tab may have changed the level or language
  // since. Only the prefs Practice itself edits are taken from the snapshot.
  const fresh = await deps.getProfile();
  const base: LearnerProfile = { ...fresh, prefs: { ...fresh.prefs, ...input.profile.prefs } };
  // W1 — fold subscores into the level remembered for the PRACTISED language
  // (which can differ from the current toggle), then restore the toggle.
  const folded = applySessionToProfile({ ...base, language: scenario.targetLanguage }, review, now);
  // E1 — tally confirmed error types against the practised language, same write.
  const withErrors = applyErrorsToProfile(folded, scenario.targetLanguage, review.errors, now);
  await deps.putProfile({ ...withErrors, language: fresh.language });
  // C1 — per-objective verdicts. Derived data: a failure here must NOT escalate
  // to ResultsPersistError (the recap and items are already stored).
  await deps
    .recordJudgeOutcomes(scenario.id, review.objectivesMet, now, scenario.objectives)
    .catch((e) => console.warn("objective ledger update failed", e));
}

async function advanceStory(deps: FinalizeDeps, scenario: Scenario, review: SessionReview | undefined): Promise<void> {
  const { arcId, episode } = scenario.arc!;
  // ORDER MATTERS, each step with its own catch. Marking the episode played is
  // the one authoritative fact; if a derived write threw first and took it
  // along,「▶ 下一集」would replay the episode just finished.
  await deps.arc
    .markEpisodePlayed(arcId, episode, deps.now())
    .catch((e) => console.warn("arc: marking the episode played failed — it may replay", e));
  if (review) {
    await recordArcCanDos(deps, arcId, episode, review).catch((e) => console.warn("arc can-do ledger update failed", e));
  }
  // Genuinely retryable: a failed generation leaves the arc untouched.
  await deps.arc.advance(arcId).catch((e) => console.warn("next episode not written yet (retried on 下一集)", e));
}

/**
 * S3 — fold this episode's can-do verdicts into the C1 ledger under the ARC's id
 * rather than the episode's scenario id: every episode is a NEW Scenario, so
 * keying on the scenario would give each can-do a fresh row and mastery could
 * never accumulate. Only can-dos are recorded here — an episode's own one-off
 * objectives stay on the episode's scenario row.
 */
async function recordArcCanDos(deps: FinalizeDeps, arcId: string, episode: number, review: SessionReview): Promise<void> {
  if (!review.objectivesMet?.length) return;
  const arc = await deps.arc.getArc(arcId);
  if (!arc) return;
  const canDoTexts = episodeCanDos(arc, arc.episodes.find((e) => e.n === episode)).map((c) => c.text);
  if (!canDoTexts.length) return;
  const verdicts = [...canonicalizeVerdicts(review.objectivesMet, canDoTexts)]
    .filter(([objective]) => canDoTexts.includes(objective))
    .map(([objective, met]) => ({ objective, met }));
  if (!verdicts.length) return;
  await deps.recordJudgeOutcomes(arcId, verdicts, deps.now(), canDoTexts);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
