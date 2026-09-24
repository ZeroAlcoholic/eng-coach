// Capability: one transcript line → Traditional Chinese (W4 tap-to-translate).

import { Type } from "@google/genai";

import { field, record, string, type Parser } from "../../../kernel/validate";
import { generateJson } from "./client";

const TRANSLATE_SCHEMA = {
  type: Type.OBJECT,
  properties: { zh: { type: Type.STRING } },
  required: ["zh"],
};

export const parseTranslation: Parser<string> = (v, path) => field(record(v, path), "zh", string, path).trim();

export async function translateLine(apiKey: string, text: string): Promise<string> {
  if (!text.trim()) return "";
  return generateJson(
    apiKey,
    `Translate this into natural Traditional Chinese (Taiwan). Return only the translation.\n\n${text}`,
    TRANSLATE_SCHEMA,
    parseTranslation,
  );
}
