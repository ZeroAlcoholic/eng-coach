// Prebuilt Gemini Live voices. The API exposes ~30 voices but does NOT label
// them by gender/age, so these pools are curated from community auditioning plus
// the official one-word styles, and are easy to retune. We randomise within a
// pool each session for variety.
//   ja: young female — gentle / bright / encouraging (travel練習，輕鬆鼓舞)
//   en: female — mostly business-warm with some bright / graceful (work，舒服輕鬆)
//
// Accent note: our live model is native-audio, which does NOT accept a
// languageCode, so Mandarin accent can't be forced via the API. The Taiwanese-
// Mandarin / no-Mainland-accent requirement is driven from the system prompt and
// by voice choice; swap entries here if any voice sounds off.

import type { TargetLanguage } from "../../kernel/types";

const VOICE_POOLS: Record<TargetLanguage, string[]> = {
  ja: ["Leda", "Aoede", "Vindemiatrix", "Sulafat", "Achernar", "Autonoe"],
  en: ["Kore", "Erinome", "Despina", "Schedar", "Zephyr", "Sulafat"],
};

export function pickVoice(language: TargetLanguage): string {
  const pool = VOICE_POOLS[language];
  return pool[Math.floor(Math.random() * pool.length)];
}
