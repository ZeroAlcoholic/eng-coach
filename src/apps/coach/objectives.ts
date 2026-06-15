// C1 — per-objective mastery ledger logic. Side-effecting upserts live here so
// finalize (judge outcomes) and the recap self-check (C3) share one read-modify-
// write path; the mastery predicate is pure so it can be unit-tested and reused
// by the live prompt (C1's consumer: flag still-developing objectives).

import { getObjective, listObjectivesFor, objectiveKey, putObjective } from "../../kernel/db";
import type { ObjectiveMastery, SessionReview } from "../../kernel/types";

/**
 * An objective is "still developing" once it HAS been assessed but isn't sticking
 * — the judge's most recent verdict was "not met", or it's met less than half the
 * time. Never-assessed objectives are NOT flagged (they're already in the
 * scenario's objective list; flagging them all would just be noise).
 */
export function isStillDeveloping(rec: ObjectiveMastery): boolean {
  if (rec.attempts < 1) return false;
  return rec.lastMet === false || rec.met / rec.attempts < 0.5;
}

/** Objective texts the coach should prioritise next session (from the ledger). */
export async function weakObjectives(scenarioId: string): Promise<string[]> {
  const recs = await listObjectivesFor(scenarioId);
  return recs.filter(isStillDeveloping).map((r) => r.objective);
}

/** C1 — fold one session's judge verdicts into the ledger (best-effort upsert). */
export async function recordJudgeOutcomes(
  scenarioId: string,
  objectivesMet: SessionReview["objectivesMet"],
  nowIso: string,
): Promise<void> {
  for (const { objective, met } of objectivesMet ?? []) {
    const id = objectiveKey(scenarioId, objective);
    const prev = await getObjective(id);
    await putObjective({
      id,
      scenarioId,
      objective,
      attempts: (prev?.attempts ?? 0) + 1,
      met: (prev?.met ?? 0) + (met ? 1 : 0),
      lastMet: met,
      selfRating: prev?.selfRating,
      updatedAt: nowIso,
    });
  }
}

/** C3 — record the learner's self-assessment for one objective. Creates the
 *  record if the judge hasn't assessed it yet (attempts stays 0). */
export async function recordSelfRating(
  scenarioId: string,
  objective: string,
  rating: ObjectiveMastery["selfRating"],
  nowIso: string,
): Promise<void> {
  const id = objectiveKey(scenarioId, objective);
  const prev = await getObjective(id);
  await putObjective({
    id,
    scenarioId,
    objective,
    attempts: prev?.attempts ?? 0,
    met: prev?.met ?? 0,
    lastMet: prev?.lastMet,
    selfRating: rating,
    updatedAt: nowIso,
  });
}
