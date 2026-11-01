// Who the learner is, for the coach to address them and cast them in the
// role-play. Every field is optional and absent = the coach behaves as before,
// so the one normalisation rule lives here and the pack reader, the settings
// form and the prompt all apply the same one.

import type { LearnerPersona } from "./types";

export const PERSONA_MAX = 40;
export const PERSONA_KEYS = ["name", "jobTitle", "orgType"] as const;

/** Collapse every run of whitespace (newlines included) to one space, trim, cap
 *  at PERSONA_MAX characters, drop blank fields; nothing left → undefined. A
 *  newline would let a field start a new section of the prompt it is put in;
 *  other text is kept as typed. */
export function normalisePersona(p: Partial<Record<keyof LearnerPersona, unknown>> | undefined): LearnerPersona | undefined {
  if (!p) return undefined;
  const out: LearnerPersona = {};
  for (const k of PERSONA_KEYS) {
    const v = p[k];
    if (typeof v !== "string") continue;
    const t = Array.from(v.replace(/\s+/g, " ").trim()).slice(0, PERSONA_MAX).join("").trim();
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The profile with this persona; a persona with nothing left removes the key,
 *  so a cleared form reads back exactly like a profile that never had one. */
export function withPersona<P extends { persona?: LearnerPersona }>(profile: P, raw: Partial<LearnerPersona> | undefined): P {
  const persona = normalisePersona(raw);
  const rest = { ...profile };
  delete rest.persona;
  return persona ? { ...rest, persona } : rest;
}
