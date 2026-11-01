// Prebuilt Gemini Live voices. The API exposes ~30 voices but does NOT label
// them by gender/age, so these pools are curated from community auditioning plus
// the official one-word styles, and are easy to retune. The voice is a hash of
// a seed (the story line's id, or the scenario's), so a recurring character
// keeps one voice across every episode instead of a new one each session.
//   ja: young female — gentle / bright / encouraging (travel練習，輕鬆鼓舞)
//   en: female — mostly business-warm with some bright / graceful (work，舒服輕鬆)
//
// Accent note: our live model is native-audio, which does NOT accept a
// languageCode, so Mandarin accent can't be forced via the API. The Taiwanese-
// Mandarin / no-Mainland-accent requirement is driven from the system prompt and
// by voice choice; swap entries here if any voice sounds off.

import type { Scenario, TargetLanguage } from "../../kernel/types";

export const VOICE_POOLS: Record<TargetLanguage, readonly string[]> = {
  ja: ["Leda", "Aoede", "Vindemiatrix", "Sulafat", "Achernar", "Autonoe"],
  en: ["Kore", "Erinome", "Despina", "Schedar", "Zephyr", "Sulafat"],
};

// 32-bit FNV-1a over UTF-16 code units: deterministic across sessions and
// devices (a pack restored elsewhere keeps the voices), and it spreads short
// ids such as UUIDs evenly over a handful of buckets.
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The same seed always gets the same voice; an empty seed gets the first. */
export function pickVoice(language: TargetLanguage, seed: string): string {
  const pool = VOICE_POOLS[language];
  return seed ? pool[fnv1a(seed) % pool.length] : pool[0];
}

/** One voice per story line; a standalone scenario keeps its own. */
export const voiceSeed = (s: Pick<Scenario, "id" | "arc">): string => s.arc?.arcId ?? s.id;
