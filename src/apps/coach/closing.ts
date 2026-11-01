// C2 — has the coach said its closing line? Speech recognition decides how the
// line is written: deltas split it anywhere, punctuation and spaces come and go,
// and Mandarin may come back in Simplified form. So the caller accumulates the
// whole coach turn, and both sides are reduced to Han characters with the
// Simplified forms of this one line mapped to Traditional before comparing.

import { CLOSING_LINE } from "./prompt";

const TO_TRADITIONAL: Record<string, string> = { 练: "練", 这: "這", 里: "裡", 裏: "裡" };

function hanOnly(text: string): string {
  return Array.from(text.replace(/[^一-鿿]/g, ""), (c) => TO_TRADITIONAL[c] ?? c).join("");
}

const TARGET = hanOnly(CLOSING_LINE);

/** True when this (accumulated) coach turn contains the closing line. */
export function saysClosingLine(coachTurn: string): boolean {
  return hanOnly(coachTurn).includes(TARGET);
}
