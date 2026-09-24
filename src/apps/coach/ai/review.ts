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

import { Type } from "@google/genai";

import { judgeSamples } from "../../../kernel/overrides";
import { CEFR_LEVELS, ERROR_TYPES } from "../../../kernel/types";
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
import { medianReview, numToCefr } from "../progress";
import { generateJson, transcriptText, type GenerateOptions } from "./client";

const REVIEW_SCHEMA = {
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
  },
  required: ["cefr", "subscores", "reviewEn", "reviewZh", "progressNote"],
};

/** Error types a text transcript can evidence. Pronunciation stays in the
 *  stored enum (older recaps carry it) but the judge may not report it. */
const TEXT_EVIDENCED_ERROR_TYPES = ERROR_TYPES.filter((t) => t !== "pronunciation");

export type JudgeOutcome =
  | { kind: "review"; review: SessionReview; samples: number }
  | { kind: "unavailable"; reason: string };

const normalise = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** Build the validator for ONE session: it needs the learner's own words to
 *  check that every reported error example was actually said. */
export function reviewParser(learnerTurns: string[]): Parser<SessionReview> {
  const learnerText = normalise(learnerTurns.join("\n"));
  const saidByLearner = (example: string) => {
    const e = normalise(example);
    return e.length >= 2 && learnerText.includes(e);
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
    // Sanity-check the model's own label, then DERIVE the headline from the
    // three skills a transcript can show. Fluency (pace, hesitation) is mostly
    // inaudible in text, so it does not drive the level.
    field(r, "cefr", enumOf(CEFR_LEVELS as readonly CEFRLevel[]), path);
    const cefr = numToCefr((subscores.grammar + subscores.vocab + subscores.interaction) / 3);
    const list = (key: string) => field(r, key, optional(arrayKeeping(nonEmptyString)), path);
    const errors = field(r, "errors", optional(arrayKeeping(parseError)), path);
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
    };
  };
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
    `inventing one).` +
    `\n\nTRANSCRIPT:\n${transcriptText(opts.transcript)}`
  );
}

export interface JudgeOptions extends GenerateOptions {
  samples?: number; // screening overrides the configured count per call
}

export async function summariseSession(
  apiKey: string,
  opts: { transcript: TranscriptTurn[]; level: CEFRLevel; previous?: string; objectives?: string[] },
  judge: JudgeOptions = {},
): Promise<JudgeOutcome> {
  const learnerTurns = opts.transcript.filter((t) => t.who === "user").map((t) => t.text);
  if (!learnerTurns.some((t) => t.trim()))
    return { kind: "unavailable", reason: "學習者沒有開口，沒有可評量的內容。" };
  const prompt = judgePrompt(opts);
  const parse = reviewParser(learnerTurns);
  const n = judge.samples ?? judgeSamples();
  // Self-consistency: sample n times and median the numbers. A sample that
  // fails validation is discarded, never patched with defaults.
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () => generateJson(apiKey, prompt, REVIEW_SCHEMA, parse, judge)),
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
