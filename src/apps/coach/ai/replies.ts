// Capability: anti-stuck — a few things the learner could say next (W4).

import { Type } from "@google/genai";

import type { Scenario, TranscriptTurn } from "../../../kernel/types";
import { arrayKeeping, field, nonEmptyString, record, type Parser } from "../../../kernel/validate";
import { generateJson, langName, transcriptText } from "./client";

const SUGGEST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { say: { type: Type.STRING }, gloss: { type: Type.STRING } },
        required: ["say", "gloss"],
      },
    },
  },
  required: ["suggestions"],
};

export interface ReplySuggestion {
  say: string; // what to say, in the target language (ja includes kana/romaji)
  gloss: string; // 繁體中文 meaning
}

const parseSuggestion: Parser<ReplySuggestion> = (v, path) => {
  const r = record(v, path);
  return { say: field(r, "say", nonEmptyString, path), gloss: field(r, "gloss", nonEmptyString, path) };
};

export const parseSuggestions: Parser<ReplySuggestion[]> = (v, path) =>
  field(record(v, path), "suggestions", arrayKeeping(parseSuggestion), path);

export async function suggestReplies(
  apiKey: string,
  opts: { scenario: Scenario; transcript: TranscriptTurn[] },
): Promise<ReplySuggestion[]> {
  const lang = langName(opts.scenario.targetLanguage);
  const tail = transcriptText(opts.transcript.slice(-6)) || "(just starting)";
  const prompt =
    `The learner is stuck in a ${lang} role-play and needs help knowing what to say next. ` +
    `Given the recent turns, suggest 2–3 SHORT, natural things THEY (the learner) could say next, at ` +
    `CEFR ${opts.scenario.level}.` +
    (opts.scenario.targetLanguage === "ja" ? " For Japanese include kana + romaji in `say`." : "") +
    ` Each item: say (in ${lang}) + gloss (Traditional Chinese meaning).\n\nRECENT:\n${tail}`;
  return generateJson(apiKey, prompt, SUGGEST_SCHEMA, parseSuggestions);
}
