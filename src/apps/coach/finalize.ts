// Shared end-of-session pipeline: persist the transcript FIRST (cheap, local —
// a later AI failure never loses it), clear the crash-recovery draft, then run
// the judge + item extraction and fold the results into the scenario's rolling
// progress note and the learner's remembered per-skill level.
//
// Used from two places: Practice (normal「停止並儲存」) and Home (recovering a
// draft left behind by a killed tab).

import { clearDraft, getArc, putItems, putProfile, putScenario, putSession } from "../../kernel/db";
import type { LearnerProfile, Scenario, TranscriptTurn } from "../../kernel/types";
import { extractLearnedItems, summariseSession, type SessionReview } from "./ai";
import { advanceArc, episodeCanDos, markEpisodePlayed, nextEpisodeGenerator } from "./arcs";
import { canonicalizeVerdicts, recordJudgeOutcomes } from "./objectives";
import { applySessionToProfile } from "./progress";

export interface FinalizeOutcome {
  items: number;
  review: SessionReview;
}

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

export function emptyReview(scenario: Scenario): SessionReview {
  return {
    cefr: scenario.level,
    reviewEn: "",
    reviewZh: "",
    progressNote: scenario.progressNote ?? "",
  };
}

export async function finalizeSession(
  apiKey: string,
  opts: {
    scenario: Scenario;
    profile: LearnerProfile; // pass with any pref changes already merged in
    sessionId: string;
    startedAt: string;
    transcript: TranscriptTurn[];
  },
): Promise<FinalizeOutcome> {
  const { scenario, profile, transcript } = opts;
  const session = {
    id: opts.sessionId,
    scenarioId: scenario.id,
    startedAt: opts.startedAt,
    transcript,
  };
  try {
    await putSession(session);
  } catch (err) {
    throw new PersistError(err); // transcript NOT saved; draft survives
  }
  // The saved record supersedes the draft. A failed clear is benign — recovery
  // re-finalizes idempotently under the same session id.
  await clearDraft().catch(() => {});
  if (!transcript.length) return { items: 0, review: emptyReview(scenario) };

  const [items, review] = await Promise.all([
    extractLearnedItems(apiKey, { scenario, sessionId: opts.sessionId, transcript }),
    summariseSession(apiKey, {
      transcript,
      level: scenario.level,
      previous: scenario.progressNote,
      objectives: scenario.objectives,
    }),
  ]);
  const outcome: FinalizeOutcome = { items: items.length, review };
  try {
    if (items.length) await putItems(items);
    await putScenario({ ...scenario, progressNote: review.progressNote });
    await putSession({ ...session, review }); // persist the recap on the session
    // W1 — fold subscores into the level remembered for the PRACTISED language
    // (which can differ from the current toggle when recovering a draft), then
    // restore the toggle so recovery never flips the UI language.
    const folded = applySessionToProfile(
      { ...profile, language: scenario.targetLanguage },
      review,
      new Date().toISOString(),
    );
    await putProfile({ ...folded, language: profile.language });
    // C1 — fold per-objective verdicts into the mastery ledger. Derived/aux
    // data: a failure here must NOT escalate to ResultsPersistError (the recap
    // and items are already stored), so it's best-effort.
    await recordJudgeOutcomes(
      scenario.id,
      review.objectivesMet,
      new Date().toISOString(),
      scenario.objectives, // canonical text so judge-string drift can't fork keys
    ).catch((e) => console.warn("objective ledger update failed", e));
  } catch (err) {
    // Storage died mid-pipeline (e.g. quota). The analysis itself succeeded —
    // a plain throw would be reported as "analysis failed", which is false.
    throw new ResultsPersistError(err, outcome);
  }

  // S1 — this session WAS an episode of a story arc: close it out and write the
  // next one. Deliberately AFTER the ResultsPersistError boundary and entirely
  // best-effort: the recap, items and level are already stored, and a failed
  // generation must leave the arc byte-identical so 「下一集」 simply retries.
  if (scenario.arc) {
    const { arcId, episode } = scenario.arc;
    try {
      await recordArcCanDos(arcId, episode, review);
      await markEpisodePlayed(arcId, episode, new Date().toISOString());
      await advanceArc(arcId, nextEpisodeGenerator(apiKey));
    } catch (e) {
      console.warn("arc advance failed (retried on 下一集)", e);
    }
  }
  return outcome;
}

/**
 * S3 — fold this episode's can-do verdicts into the C1 ledger under the ARC's id
 * rather than the episode's scenario id.
 *
 * That is the whole point: every episode is a NEW Scenario, so keying on the
 * scenario would give each can-do a fresh row with attempts=1 and mastery could
 * never accumulate. The arc id is stable for the life of the story and its
 * can-do texts are frozen at creation, which is exactly the stable objective
 * identity C1's ledger needs (see ROADMAP "Deferred — cross-scenario scheduler":
 * an arc is the one place that identity legitimately exists).
 *
 * Only can-dos are recorded here — an episode's own one-off objectives stay on
 * the episode's scenario row, where they belong.
 */
async function recordArcCanDos(
  arcId: string,
  episode: number,
  review: SessionReview,
): Promise<void> {
  if (!review.objectivesMet?.length) return;
  const arc = await getArc(arcId);
  if (!arc) return;
  const canDoTexts = episodeCanDos(arc, arc.episodes.find((e) => e.n === episode)).map((c) => c.text);
  if (!canDoTexts.length) return;
  const verdicts = [...canonicalizeVerdicts(review.objectivesMet, canDoTexts)]
    .filter(([objective]) => canDoTexts.includes(objective))
    .map(([objective, met]) => ({ objective, met }));
  if (!verdicts.length) return;
  await recordJudgeOutcomes(arcId, verdicts, new Date().toISOString(), canDoTexts);
}
