// U1 — the ONE main action Home shows above the fold. Order: nothing works
// without a key; an unsaved session comes next, because its review is lost
// learning if it waits; then an unfinished story line, the strongest pull; then
// a replay of what was practised last; otherwise a fresh random scene.

export type PrimaryAction = "key" | "draft" | "arc" | "replay" | "new";

export function primaryAction(s: {
  hasKey: boolean;
  hasDraft: boolean;
  hasArc: boolean;
  hasLastPracticed: boolean;
}): PrimaryAction {
  if (!s.hasKey) return "key";
  if (s.hasDraft) return "draft";
  if (s.hasArc) return "arc";
  if (s.hasLastPracticed) return "replay";
  return "new";
}
