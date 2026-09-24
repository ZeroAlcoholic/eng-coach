// Capability: a finished transcript → LearnedItem[] (the interop unit other
// tools consume).

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
        },
        required: ["kind", "text", "meaning"],
      },
    },
  },
  required: ["items"],
};

export type RawItem = Pick<LearnedItem, "kind" | "text" | "reading" | "meaning" | "example">;

const ITEM_KINDS = ["word", "phrase", "grammar"] as const;

const parseRawItem: Parser<RawItem> = (v, path) => {
  const r = record(v, path);
  const reading = field(r, "reading", optional(string), path)?.trim();
  const example = field(r, "example", optional(string), path)?.trim();
  return {
    kind: field(r, "kind", enumOf(ITEM_KINDS), path),
    text: field(r, "text", nonEmptyString, path),
    meaning: field(r, "meaning", nonEmptyString, path),
    ...(reading ? { reading } : {}),
    ...(example ? { example } : {}),
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
    `if helpful, else ""); meaning in Traditional Chinese; a short example sentence. Skip ` +
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
