// Capability: a finished transcript → the end-of-session recap (the "judge").
//
// What a TEXT transcript can and cannot prove decides the contract here:
//   - It cannot prove pronunciation. The prompt does not ask for it, and a
//     `pronunciation` error the model reports anyway is dropped.
//   - An error pattern is evidence only if its `example` is something the
//     learner actually said: the example must be a substring of a learner turn.
//   - The overall CEFR is derived from the grammar / vocabulary / interaction
//     subscores, not taken from the model's headline guess.
//   - If no sample survives validation, the outcome is `unavailable` — never a
//     recap with the target level standing in for a measurement.
//   - A turn annotated as an echo of the coach or as containing Chinese is
//     shown to the model with that label and is not evidence of a can-do; a
//     transcript with nothing else in it is `unavailable` before any call.
//   - `l1Fallbacks[].said` must be a substring of a learner turn and
//     `pronunciationNotes[]` a substring of a coach turn: what the model quotes
//     must exist, on the side it claims.

import { Type } from "@google/genai";

import { judgeSamples } from "../../../kernel/overrides";
import { ERROR_TYPES } from "../../../kernel/types";
import type { CEFRLevel, ErrorType, SessionReview, TranscriptTurn } from "../../../kernel/types";
import {
  arrayKeeping,
  boolean,
  enumOf,
  field,
  integerIn,
  Invalid,
  nonEmptyString,
  optional,
  record,
  string,
  type Parser,
} from "../../../kernel/validate";
import { normaliseForMatch } from "../annotate";
import { medianReview, numToCefr } from "../progress";
import { generateJson, type GenerateOptions } from "./client";

export const REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cefr: { type: Type.STRING },
    subscores: {
      type: Type.OBJECT,
      properties: {
        grammar: { type: Type.INTEGER },
        vocab: { type: Type.INTEGER },
        fluency: { type: Type.INTEGER },
        interaction: { type: Type.INTEGER },
      },
      required: ["grammar", "vocab", "fluency", "interaction"],
    },
    reviewEn: { type: Type.STRING },
    reviewZh: { type: Type.STRING },
    progressNote: { type: Type.STRING },
    wins: { type: Type.ARRAY, items: { type: Type.STRING } },
    fixes: { type: Type.ARRAY, items: { type: Type.STRING } },
    objectivesMet: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { objective: { type: Type.STRING }, met: { type: Type.BOOLEAN } },
        required: ["objective", "met"],
      },
    },
    errors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: [...ERROR_TYPES] },
          example: { type: Type.STRING },
          correction: { type: Type.STRING },
        },
        required: ["type", "example", "correction"],
      },
    },
    l1Fallbacks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { said: { type: Type.STRING }, target: { type: Type.STRING } },
        required: ["said", "target"],
      },
    },
    pronunciationNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["cefr", "subscores", "reviewEn", "reviewZh", "progressNote"],
};

const MAX_L1_FALLBACKS = 5;
const MAX_PRONUNCIATION_NOTES = 3;

/** Error types a text transcript can evidence. Pronunciation stays in the
 *  stored enum (older recaps carry it) but the judge may not report it. */
const TEXT_EVIDENCED_ERROR_TYPES = ERROR_TYPES.filter((t) => t !== "pronunciation");

export type JudgeOutcome =
  | { kind: "review"; review: SessionReview; samples: number }
  | { kind: "unavailable"; reason: string };

/** Build the validator for ONE session: it needs the learner's own words to
 *  check that every reported error example was actually said, and the coach's
 *  to check that every pronunciation note quotes the coach. A quote must sit
 *  inside ONE turn, under the same normalisation the l1 backfill uses, so
 *  whatever passes here can be found again on a turn. */
export function reviewParser(learnerTurns: string[], coachTurns: string[] = []): Parser<SessionReview> {
  const learner = learnerTurns.map(normaliseForMatch);
  const coach = coachTurns.map(normaliseForMatch);
  const saidIn = (turns: string[], quote: string) => {
    const q = normaliseForMatch(quote);
    return q.length >= 2 && turns.some((t) => t.includes(q));
  };
  const saidByLearner = (example: string) => saidIn(learner, example);
  const saidByCoach = (note: string) => saidIn(coach, note);
  const parseFallback: Parser<{ said: string; target: string }> = (v, path) => {
    const r = record(v, path);
    const said = field(r, "said", nonEmptyString, path);
    if (!saidByLearner(said)) throw new Invalid(`${path}.said`, "not found in the learner's turns");
    return { said, target: field(r, "target", nonEmptyString, path) };
  };
  const parseNote: Parser<string> = (v, path) => {
    const note = nonEmptyString(v, path);
    if (!saidByCoach(note)) throw new Invalid(path, "not found in the coach's turns");
    return note;
  };
  const parseError: Parser<NonNullable<SessionReview["errors"]>[number]> = (v, path) => {
    const r = record(v, path);
    const type = field(r, "type", enumOf(TEXT_EVIDENCED_ERROR_TYPES as readonly ErrorType[]), path);
    const example = field(r, "example", nonEmptyString, path);
    if (!saidByLearner(example)) throw new Invalid(`${path}.example`, "not found in the learner's turns");
    return { type, example, correction: field(r, "correction", nonEmptyString, path) };
  };
  const parseVerdict: Parser<{ objective: string; met: boolean }> = (v, path) => {
    const r = record(v, path);
    return { objective: field(r, "objective", nonEmptyString, path), met: field(r, "met", boolean, path) };
  };
  const score = integerIn(1, 6);
  return (v, path) => {
    const r = record(v, path);
    const s = field(r, "subscores", record, path);
    const subscores = {
      grammar: field(s, "grammar", score, `${path}.subscores`),
      vocab: field(s, "vocab", score, `${path}.subscores`),
      fluency: field(s, "fluency", score, `${path}.subscores`),
      interaction: field(s, "interaction", score, `${path}.subscores`),
    };
    // The headline is DERIVED from the three skills a transcript can show —
    // fluency (pace, hesitation) is mostly inaudible in text. The model's own
    // `cefr` label is not used, so a "B1+" or "A2/B1" must not void the sample.
    const cefr = numToCefr((subscores.grammar + subscores.vocab + subscores.interaction) / 3);
    const list = (key: string) => field(r, key, optional(arrayKeeping(nonEmptyString)), path);
    const errors = field(r, "errors", optional(arrayKeeping(parseError)), path);
    const l1Fallbacks = field(r, "l1Fallbacks", optional(arrayKeeping(parseFallback)), path)?.slice(0, MAX_L1_FALLBACKS);
    const pronunciationNotes = field(r, "pronunciationNotes", optional(arrayKeeping(parseNote)), path)?.slice(
      0,
      MAX_PRONUNCIATION_NOTES,
    );
    return {
      cefr,
      subscores,
      reviewEn: field(r, "reviewEn", string, path).trim(),
      reviewZh: field(r, "reviewZh", string, path).trim(),
      progressNote: field(r, "progressNote", string, path).trim(),
      wins: list("wins"),
      fixes: list("fixes"),
      objectivesMet: field(r, "objectivesMet", optional(arrayKeeping(parseVerdict)), path),
      errors: errors ?? [],
      ...(l1Fallbacks?.length ? { l1Fallbacks } : {}),
      ...(pronunciationNotes?.length ? { pronunciationNotes } : {}),
    };
  };
}

/** The transcript as the judge reads it: annotated learner turns carry the
 *  label the prompt's rules refer to, so the model discounts them without
 *  having to guess which lines were parroted or Chinese. */
export function judgeTranscriptText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => {
      const tags = t.who === "user" ? `${t.echo ? "[repeated after coach] " : ""}${t.l1 ? "[contains Chinese] " : ""}` : "";
      return `${t.who}: ${tags}${t.text}`;
    })
    .join("\n");
}

export function judgePrompt(opts: {
  transcript: TranscriptTurn[];
  level: CEFRLevel;
  previous?: string;
  objectives?: string[];
}): string {
  const objectivesBlock = opts.objectives?.length
    ? ` The session objectives were:\n${opts.objectives.map((o) => `- ${o}`).join("\n")}\n` +
      `For objectivesMet, judge each objective above as met true/false from the learner's actual speech.`
    : "";
  return (
    `You are a CEFR speaking examiner reading a TEXT transcript (speech-to-text, no audio). The learner's ` +
    `target level is CEFR ${opts.level}${opts.previous ? ` and the previous note was "${opts.previous}"` : ""}.` +
    objectivesBlock +
    `\nReason from the LEARNER's turns only, and only about what the text shows — never comment on ` +
    `pronunciation or accent. Return JSON: cefr (honest CEFR of this session, e.g. "B1"); ` +
    `subscores as integers 1–6 (1=A1 … 6=C2) for grammar, vocab, fluency (as visible in text: sentence ` +
    `length, connectors, self-corrections), interaction; reviewEn (ONE encouraging English sentence); ` +
    `reviewZh (ONE Taiwan-colloquial Traditional Chinese sentence, same gist); wins (1–3 short things ` +
    `they did well); fixes (1–3 short items to fix, each WITH the natural corrected version); ` +
    `progressNote (one or two concrete English sentences naming the specific grammar/phrase points to ` +
    `target next time so the next session can coach them directly); errors (up to 3 error PATTERNS in ` +
    `the learner's speech, each as: type, chosen ONLY from this closed list [${TEXT_EVIDENCED_ERROR_TYPES.join(", ")}]; ` +
    `example, the learner's own words copied VERBATIM from a learner turn; correction, the natural ` +
    `version. Report a pattern only if you can quote a real slip — return an empty list rather than ` +
    `inventing one); l1Fallbacks (up to ${MAX_L1_FALLBACKS} places where the learner put a CHINESE word or phrase ` +
    `inside a target-language sentence because they lacked the word: said, the Chinese part copied VERBATIM ` +
    `from the learner turn; target, the natural target-language word or phrase for it. Empty list if none); ` +
    `pronunciationNotes (up to ${MAX_PRONUNCIATION_NOTES} sounds the COACH explicitly pointed out, each copied VERBATIM from a ` +
    `coach turn — a text transcript cannot show pronunciation, so only the coach's own words count; empty list if none).` +
    `\nRULES: a learner turn labelled [repeated after coach] is the coach's line said back, and one labelled ` +
    `[contains Chinese] is not target-language production — neither counts as evidence that an objective was met ` +
    `or as a sign of level. An objective is met ONLY when the learner completed it entirely in the target ` +
    `language; completing it with a Chinese word or with the coach's own line is NOT met. The transcript comes ` +
    `from speech recognition: do not report wordChoice for a word that merely sounds like the intended one ` +
    `unless the context proves the learner meant something else.` +
    `\n\nTRANSCRIPT:\n${judgeTranscriptText(opts.transcript)}`
  );
}

export interface JudgeOptions extends GenerateOptions {
  samples?: number; // screening overrides the configured count per call
  generate?: typeof generateJson; // tests stand in here; production is the real call
}

/** Why a transcript cannot be judged without calling anyone, or null. */
export function unjudgeable(transcript: TranscriptTurn[]): string | null {
  const learner = transcript.filter((t) => t.who === "user" && t.text.trim());
  if (!learner.length) return "學習者沒有開口，沒有可評量的內容。";
  if (learner.every((t) => t.echo)) return "學習者只有跟著教練複誦，沒有自己的產出可評量。";
  if (learner.every((t) => t.l1)) return "學習者只說了中文，沒有目標語產出可評量。";
  if (learner.every((t) => t.echo || t.l1)) return "學習者只有複誦與中文，沒有目標語產出可評量。";
  return null;
}

export async function summariseSession(
  apiKey: string,
  opts: { transcript: TranscriptTurn[]; level: CEFRLevel; previous?: string; objectives?: string[] },
  judge: JudgeOptions = {},
): Promise<JudgeOutcome> {
  const reason = unjudgeable(opts.transcript);
  if (reason) return { kind: "unavailable", reason };
  const learnerTurns = opts.transcript.filter((t) => t.who === "user").map((t) => t.text);
  const coachTurns = opts.transcript.filter((t) => t.who === "coach").map((t) => t.text);
  const prompt = judgePrompt(opts);
  const parse = reviewParser(learnerTurns, coachTurns);
  const n = judge.samples ?? judgeSamples();
  const generate = judge.generate ?? generateJson;
  // Self-consistency: sample n times and median the numbers. A sample that
  // fails validation is discarded, never patched with defaults.
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () => generate(apiKey, prompt, REVIEW_SCHEMA, parse, judge)),
  );
  const valid = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!valid.length) {
    const first = settled.find((s) => s.status === "rejected");
    const reason = first?.status === "rejected" ? describe(first.reason) : "沒有有效的評量樣本";
    return { kind: "unavailable", reason };
  }
  return { kind: "review", review: medianReview(valid), samples: valid.length };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
