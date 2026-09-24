// Capability (E3): review extras for ONE item — a cloze sentence (only when the
// item's own example can't supply one) and 2–3 collocations.
//
// Deliberately NO multiple-choice distractors: generated distractors are wrong
// about half the time in a way the learner can't detect, which teaches the wrong
// form. Recall-then-reveal needs no options, so the failure mode is designed out.

import { Type } from "@google/genai";

import type { LearnedItem } from "../../../kernel/types";
import { arrayKeeping, field, nonEmptyString, optional, record, string, type Parser } from "../../../kernel/validate";
import { generateJson, langName } from "./client";

const REVIEW_EXTRAS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cloze: { type: Type.STRING },
    collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["cloze", "collocations"],
};

export interface ReviewExtras {
  cloze: string; // one sentence with the item replaced by the blank token ("" if none)
  collocations: string[]; // 2–3 natural partners, target language
}

export const parseReviewExtras: Parser<ReviewExtras> = (v, path) => {
  const r = record(v, path);
  return {
    cloze: (field(r, "cloze", optional(string), path) ?? "").trim(),
    collocations: (field(r, "collocations", optional(arrayKeeping(nonEmptyString)), path) ?? [])
      .map((c) => c.trim())
      .slice(0, 3),
  };
};

export async function generateReviewExtras(
  apiKey: string,
  opts: { item: LearnedItem; blank: string },
): Promise<ReviewExtras> {
  const lang = langName(opts.item.language);
  return generateJson(
    apiKey,
    `A Taiwanese learner is reviewing this ${lang} item: 「${opts.item.text}」` +
      (opts.item.meaning ? ` (${opts.item.meaning})` : "") +
      `.\nReturn:\n` +
      `- cloze: ONE short, natural ${lang} sentence that needs this item, with the item itself ` +
      `replaced by exactly "${opts.blank}". Keep every other word intact; do NOT include the ` +
      `answer anywhere in the sentence.\n` +
      `- collocations: 2-3 words or short phrases that naturally go WITH this item in ${lang} ` +
      `(collocations or same word-family). No definitions, no translations.`,
    REVIEW_EXTRAS_SCHEMA,
    parseReviewExtras,
  );
}
