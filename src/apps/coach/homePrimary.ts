// U1 — the ONE main action Home shows above the fold. Order: nothing works
// without a key; an unfinished story line is the strongest pull; then a replay
// of what was practised last; otherwise a fresh random scene.

export type PrimaryAction = "key" | "arc" | "replay" | "new";

export function primaryAction(s: { hasKey: boolean; hasArc: boolean; hasLastPracticed: boolean }): PrimaryAction {
  if (!s.hasKey) return "key";
  if (s.hasArc) return "arc";
  if (s.hasLastPracticed) return "replay";
  return "new";
}
