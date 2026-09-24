// The ONE thing to take from a session, and the 90-second follow-up that drills
// it. Priority: an error that blocks meaning > an error the learner keeps making
// across sessions > a can-do the judge graded not met. One focus, never a list —
// a list is a report; a single next move is coaching.

import type { ErrorType, LearnerProfile, SessionReview, TargetLanguage } from "../../kernel/types";
import { ERROR_TYPE_LABEL } from "../../kernel/types";

/** Error types that change WHAT was said, not just how well. */
export const MEANING_BLOCKING: readonly ErrorType[] = ["wordChoice", "wordOrder", "particle", "tense"];

export type Focus =
  | { kind: "meaning"; type: ErrorType; example: string; correction: string }
  | { kind: "recurring"; type: ErrorType; example: string; correction: string; sessions: number }
  | { kind: "cando"; objective: string };

export function pickFocus(review: SessionReview, profile: LearnerProfile, language: TargetLanguage): Focus | null {
  const errors = review.errors ?? [];
  const blocking = errors.find((e) => MEANING_BLOCKING.includes(e.type));
  if (blocking) return { kind: "meaning", ...blocking };
  const log = profile.errorLog?.[language] ?? {};
  const recurring = errors
    .map((e) => ({ e, count: log[e.type]?.count ?? 0 }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count)[0];
  if (recurring) return { kind: "recurring", ...recurring.e, sessions: recurring.count };
  const unmet = review.objectivesMet?.find((o) => !o.met);
  if (unmet) return { kind: "cando", objective: unmet.objective };
  return null;
}

/** What the learner sees on the recap card. */
export function describeFocus(f: Focus): string {
  switch (f.kind) {
    case "meaning":
      return `${ERROR_TYPE_LABEL[f.type]}：你說「${f.example}」→ 自然說法「${f.correction}」`;
    case "recurring":
      return `${ERROR_TYPE_LABEL[f.type]}（已在 ${f.sessions} 次練習出現）：「${f.example}」→「${f.correction}」`;
    case "cando":
      return `還沒做到：${f.objective}`;
    default:
      return assertNever(f);
  }
}

/** Appended to the system instruction for the micro session. English on purpose:
 *  it is an instruction to the model, in the same register as the rest. */
export function microInstruction(f: Focus): string {
  const target =
    f.kind === "cando"
      ? `the can-do「${f.objective}」— set up two or three quick moments that require exactly this`
      : `${f.type}: the learner said「${f.example}」; the natural form is「${f.correction}」. Create three or four ` +
        `quick prompts that each REQUIRE this form, let them self-repair once before you model it`;
  return [
    "",
    "── 90-SECOND FOCUSED FOLLOW-UP (overrides the opening sequence above) ──",
    "This is NOT a new scene and there is no planning beat or recap. Say in ONE short Traditional Chinese " +
      "sentence what the next minute drills, then go straight into it, staying inside the same context.",
    `Drill ONLY this: ${target}.`,
    "Keep every prompt to one line. After about 90 seconds (three to four exchanges), stop cleanly: one short " +
      "sentence of encouragement in Traditional Chinese and「好，這段結束。」Do not start anything new.",
  ].join("\n");
}

function assertNever(x: never): never {
  throw new Error(`unhandled focus: ${JSON.stringify(x)}`);
}
