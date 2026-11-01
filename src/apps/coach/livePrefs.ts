// The prefs Practice writes, built from its local state. Every write sends the
// whole set, because the `profile` prop is stale for the rest of a session; an
// optional pref the learner never touched stays absent, so an old profile
// reads exactly as before.

import type { LearnerProfile } from "../../kernel/types";

export type LivePrefs = NonNullable<LearnerProfile["prefs"]>;

export function livePrefs(s: {
  slowSpeech: boolean;
  showLevelMeter: boolean;
  taskCardOpen: boolean | undefined; // I3 — absent = folded live
  turnCue: boolean | undefined; // C1 — absent = on
}): LivePrefs {
  return {
    slowSpeech: s.slowSpeech,
    showLevelMeter: s.showLevelMeter,
    ...(s.taskCardOpen === undefined ? {} : { taskCardOpen: s.taskCardOpen }),
    ...(s.turnCue === undefined ? {} : { turnCue: s.turnCue }),
  };
}

/** C1 — the turn tone and buzz are on unless the learner turned them off. */
export const turnCueOn = (prefs: LearnerProfile["prefs"]): boolean => prefs?.turnCue !== false;
