// Capability: a brief / pasted Markdown → a structured Scenario.

import { Type } from "@google/genai";

import type { CEFRLevel, Scenario, TargetLanguage } from "../../../kernel/types";
import { arrayKeeping, field, nonEmptyString, record, type Parser } from "../../../kernel/validate";
import { FRAME_PRESETS } from "../frames";
import { generateJson } from "./client";

const SCENARIO_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    contentContext: { type: Type.STRING },
    coachRole: { type: Type.STRING },
    userRole: { type: Type.STRING },
    objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
    targetPhrases: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["title", "contentContext", "coachRole", "userRole", "objectives", "targetPhrases"],
};

export type ScenarioDraft = Pick<
  Scenario,
  "title" | "contentContext" | "coachRole" | "userRole" | "objectives" | "targetPhrases"
>;

export const parseScenarioDraft: Parser<ScenarioDraft> = (v, path) => {
  const r = record(v, path);
  return {
    title: field(r, "title", nonEmptyString, path),
    contentContext: field(r, "contentContext", nonEmptyString, path),
    coachRole: field(r, "coachRole", nonEmptyString, path),
    userRole: field(r, "userRole", nonEmptyString, path),
    objectives: field(r, "objectives", arrayKeeping(nonEmptyString), path),
    targetPhrases: field(r, "targetPhrases", arrayKeeping(nonEmptyString), path),
  };
};

export async function generateScenario(
  apiKey: string,
  opts: { brief: string; language: TargetLanguage; level: CEFRLevel },
): Promise<Scenario> {
  const langName = opts.language === "ja" ? "Japanese (for travel)" : "English (for work/meetings)";
  const prompt =
    `Design a ${langName} speaking-practice scenario for a learner at CEFR ${opts.level}, ` +
    `based on this brief. Extract: a short title; a vivid, SPECIFIC situation ` +
    `(contentContext) the conversation happens in; who the coach should play (coachRole); ` +
    `who the learner plays (userRole); 3-5 concrete objectives; and 5-10 useful target ` +
    `words/phrases. Keep each field concise.\n\nBRIEF:\n${opts.brief}`;

  const gen = await generateJson(apiKey, prompt, SCENARIO_SCHEMA, parseScenarioDraft);
  return {
    id: crypto.randomUUID(),
    targetLanguage: opts.language,
    level: opts.level,
    baseContext: FRAME_PRESETS[opts.language], // editable Layer-1 preset
    source: opts.brief,
    ...gen,
  };
}
