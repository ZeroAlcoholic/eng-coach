// Turn annotations, computed once at finalize from the transcript alone (zero
// API). They exist so the judge, the chunk-use matcher and the Home readouts
// can tell learner production apart from three things that look like it in a
// transcript but are not:
//   echo  — parroting the coach's previous line;
//   aided — speaking right after asking for help (out loud, or with a button);
//   l1    — Chinese where the target language was expected.
// Every rule here is a pure function of text, so it under-marks rather than
// guesses: a turn it cannot classify is left unflagged, which is the ordinary
// case and carries no meaning of its own.

import type { TargetLanguage, TranscriptTurn } from "../../kernel/types";
import { HELP_TRIGGERS } from "./prompt";

// A learner line counts as an echo when at least this share of its tokens
// appear in the coach's previous line…
const ECHO_COVERAGE = 0.8;
// …and it is long enough for that to mean something. "Yes, thank you" after
// "Thank you for coming" is not parroting; a full sentence is.
const ECHO_MIN_TOKENS: Record<TargetLanguage, number> = { en: 3, ja: 6 };

/** Words for English (letters/digits, case-folded); characters for Japanese
 *  (no word boundaries to lean on), punctuation and spaces dropped. */
function tokens(text: string, language: TargetLanguage): string[] {
  const lower = text.toLocaleLowerCase();
  if (language === "en") return lower.match(/[\p{L}\p{N}']+/gu) ?? [];
  return [...lower].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
}

function isEcho(learner: string, coach: string, language: TargetLanguage): boolean {
  const said = tokens(learner, language);
  if (said.length < ECHO_MIN_TOKENS[language]) return false;
  const heard = new Set(tokens(coach, language));
  const covered = said.filter((t) => heard.has(t)).length;
  return covered / said.length >= ECHO_COVERAGE;
}

// Speech recognition may write a Chinese request in simplified script even
// though the learner speaks Taiwanese Mandarin. Fold the few characters the
// triggers contain, so the match does not hinge on the recogniser's script.
const SIMPLIFIED: Record<string, string> = { 说: "說", 讲: "講", 么: "麼", 译: "譯", 点: "點", 这: "這", 个: "個" };
const foldScript = (s: string) => [...s].map((ch) => SIMPLIFIED[ch] ?? ch).join("");

/** Does this learner line ask the coach for help (out loud)? */
export function isHelpRequest(text: string): boolean {
  const folded = foldScript(text);
  return HELP_TRIGGERS.some((trigger) => folded.includes(trigger));
}

const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Chinese (or kana) inside an English-practice turn means the turn is not
 *  English production. For Japanese practice the same characters ARE the
 *  target language, so text alone cannot tell; the judge's l1Fallbacks do. */
function containsL1(text: string, language: TargetLanguage): boolean {
  return language === "en" && HAN_OR_KANA.test(text);
}

/**
 * Pure: the same transcript with echo / aided / l1 set on the learner turns
 * the rules identify. `aidedTurnIdx` are the transcript lengths recorded when a
 * help button was tapped; the first learner turn at or after each index is the
 * one spoken with that help. Flags already present on the input are kept.
 */
export function annotateTurns(
  transcript: readonly TranscriptTurn[],
  language: TargetLanguage,
  aidedTurnIdx: readonly number[] = [],
): TranscriptTurn[] {
  const aidedAt = new Set<number>();
  for (const idx of aidedTurnIdx) {
    const next = transcript.findIndex((t, i) => i >= idx && t.who === "user");
    if (next >= 0) aidedAt.add(next);
  }
  let lastCoach: string | null = null;
  let helpPending = false;
  return transcript.map((turn, i) => {
    if (turn.who === "coach") {
      lastCoach = turn.text;
      return turn;
    }
    const flags: Pick<TranscriptTurn, "echo" | "aided" | "l1"> = {};
    if (lastCoach !== null && isEcho(turn.text, lastCoach, language)) flags.echo = true;
    if (helpPending || aidedAt.has(i)) flags.aided = true;
    if (containsL1(turn.text, language)) flags.l1 = true;
    helpPending = isHelpRequest(turn.text);
    return { ...turn, ...flags };
  });
}

/** The judge names the Chinese words a learner used (`l1Fallbacks[].said`);
 *  mark the turns those words were said in. This is how a Japanese-practice
 *  turn gets its l1 flag, since the text rule above cannot fire there. */
export function markL1FromFallbacks(
  transcript: readonly TranscriptTurn[],
  fallbacks: readonly { said: string }[] | undefined,
): TranscriptTurn[] {
  const said = (fallbacks ?? []).map((f) => f.said.trim().toLocaleLowerCase()).filter((s) => s.length > 0);
  if (!said.length) return [...transcript];
  return transcript.map((turn) => {
    if (turn.who !== "user" || turn.l1) return turn;
    const text = turn.text.toLocaleLowerCase();
    return said.some((s) => text.includes(s)) ? { ...turn, l1: true } : turn;
  });
}

/** Learner turns that count as the learner's own target-language production. */
export function isOwnProduction(turn: TranscriptTurn): boolean {
  return turn.who === "user" && !turn.echo && !turn.aided && !turn.l1;
}
