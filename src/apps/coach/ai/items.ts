// Capability: a finished transcript → LearnedItem[] (the interop unit other
// tools consume).
//
// A grammar item may carry a `frame` — the pattern with `___` for each slot.
// The validator keeps a frame only when it has at least one anchor (a fixed
// part of two or more characters) and every anchor occurs in the example, so a
// frame that could not match its own example never reaches the chunk-use
// matcher. A rejected frame drops the frame, not the item.

import { Type } from "@google/genai";

import type { LearnedItem, Scenario, TranscriptTurn } from "../../../kernel/types";
import {
  arrayKeeping,
  enumOf,
  field,
  nonEmptyString,
  optional,
  record,
  string,
  type Parser,
} from "../../../kernel/validate";
import { frameAnchors } from "../uses";
import { generateJson, langName, transcriptText } from "./client";

const ITEMS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING }, // "word" | "phrase" | "grammar" (pinned in the prompt)
          text: { type: Type.STRING },
          reading: { type: Type.STRING },
          meaning: { type: Type.STRING },
          example: { type: Type.STRING },
          frame: { type: Type.STRING },
        },
        required: ["kind", "text", "meaning"],
      },
    },
  },
  required: ["items"],
};

export type RawItem = Pick<LearnedItem, "kind" | "text" | "reading" | "meaning" | "example" | "frame">;

const ITEM_KINDS = ["word", "phrase", "grammar"] as const;

/** A frame is kept only if its anchors can be found in the example. */
export function validFrame(frame: string | undefined, kind: RawItem["kind"], example: string | undefined): string | undefined {
  if (!frame || kind !== "grammar" || !example) return undefined;
  const anchors = frameAnchors(frame);
  if (!anchors.length) return undefined;
  const ex = example.toLocaleLowerCase();
  return anchors.every((a) => ex.includes(a)) ? frame.trim() : undefined;
}

const parseRawItem: Parser<RawItem> = (v, path) => {
  const r = record(v, path);
  const kind = field(r, "kind", enumOf(ITEM_KINDS), path);
  const reading = field(r, "reading", optional(string), path)?.trim();
  const example = field(r, "example", optional(string), path)?.trim();
  const frame = validFrame(field(r, "frame", optional(string), path), kind, example);
  return {
    kind,
    text: field(r, "text", nonEmptyString, path),
    meaning: field(r, "meaning", nonEmptyString, path),
    ...(reading ? { reading } : {}),
    ...(example ? { example } : {}),
    ...(frame ? { frame } : {}),
  };
};

/** One malformed item must not void the fourteen good ones: bad entries drop. */
export const parseRawItems: Parser<RawItem[]> = (v, path) =>
  field(record(v, path), "items", arrayKeeping(parseRawItem), path);

export async function extractLearnedItems(
  apiKey: string,
  opts: { scenario: Scenario; sessionId: string; transcript: TranscriptTurn[] },
): Promise<LearnedItem[]> {
  if (!opts.transcript.length) return [];
  const prompt =
    `From this ${langName(opts.scenario.targetLanguage)} practice transcript, list up to 15 notable items the learner ` +
    `encountered or was corrected on: vocabulary (word), useful expressions (phrase), or ` +
    `grammar points (grammar). For each give: kind; text (the item); reading (kana/pinyin ` +
    `if helpful, else ""); meaning in Traditional Chinese; a short example sentence; and for a ` +
    `grammar item only, frame — the pattern with ___ for each open slot (e.g. "I'd rather ___ than ___"), ` +
    `whose fixed words all appear in the example. Give priority to words the learner replaced with ` +
    `Chinese mid-sentence: list the ${langName(opts.scenario.targetLanguage)} word as the item, and use the ` +
    `coach's ${langName(opts.scenario.targetLanguage)} version of the sentence as the example. Skip ` +
    `trivial words.\n\nTRANSCRIPT:\n${transcriptText(opts.transcript)}`;

  const items = await generateJson(apiKey, prompt, ITEMS_SCHEMA, parseRawItems);
  const now = new Date().toISOString();
  return items.map((r) => ({
    id: crypto.randomUUID(),
    language: opts.scenario.targetLanguage,
    sourceScenarioId: opts.scenario.id,
    sourceSessionId: opts.sessionId,
    firstSeenAt: now,
    ...r,
  }));
}
