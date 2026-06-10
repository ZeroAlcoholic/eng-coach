// Shared end-of-session pipeline: persist the transcript FIRST (cheap, local —
// a later AI failure never loses it), clear the crash-recovery draft, then run
// the judge + item extraction and fold the results into the scenario's rolling
// progress note and the learner's remembered per-skill level.
//
// Used from two places: Practice (normal「停止並儲存」) and Home (recovering a
// draft left behind by a killed tab).

import { clearDraft, putItems, putProfile, putScenario, putSession } from "../../kernel/db";
import type { LearnerProfile, Scenario, TranscriptTurn } from "../../kernel/types";
import { extractLearnedItems, summariseSession, type SessionReview } from "./ai";
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
  } catch (err) {
    // Storage died mid-pipeline (e.g. quota). The analysis itself succeeded —
    // a plain throw would be reported as "analysis failed", which is false.
    throw new ResultsPersistError(err, outcome);
  }
  return outcome;
}
