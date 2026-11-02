// Turning a scenario's discussion mode on or off. Off removes the field rather
// than storing `mode: undefined`, so a scenario switched back reads exactly
// like one that never had it (the meeting default) in storage and in packs.

import type { Scenario } from "../../kernel/types";

export const isDiscussion = (s: Scenario): boolean => s.mode === "discussion";

export function withDiscussion(s: Scenario, on: boolean): Scenario {
  if (on) return { ...s, mode: "discussion" };
  const rest = { ...s };
  delete rest.mode;
  return rest;
}
