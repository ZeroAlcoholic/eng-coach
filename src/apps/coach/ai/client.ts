// The one place the text model is called. Every capability in this folder is
// prompt + response schema + `parse`, and goes through `generateJson`, which
// hands the model's JSON to the capability's own validator — the model's output
// is untrusted input, never `as T`.

import { GoogleGenAI } from "@google/genai";

import { textModel } from "../../../kernel/overrides";
import { Invalid, type Parser } from "../../../kernel/validate";

export { Invalid };

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

// Cheapest possible liveness probe for a pasted key: models.list is a GET that
// costs no tokens. A typo'd key must fail HERE, at save time, not minutes later
// mid-practice with a raw English error.
export async function validateApiKey(apiKey: string): Promise<void> {
  await client(apiKey).models.list({ config: { pageSize: 1 } });
}

export interface GenerateOptions {
  model?: string; // screening overrides the configured model per call
}

/** Ask the model for JSON matching `schema`, then narrow it with `parse`. A
 *  response that is not JSON, or not the shape asked for, throws `Invalid`. */
export async function generateJson<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  parse: Parser<T>,
  opts: GenerateOptions = {},
): Promise<T> {
  const res = await client(apiKey).models.generateContent({
    model: opts.model ?? textModel(),
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: schema },
  });
  let raw: unknown;
  try {
    raw = JSON.parse(res.text ?? "");
  } catch {
    throw new Invalid("$", "model response was not JSON");
  }
  return parse(raw, "$");
}

export const langName = (l: "en" | "ja") => (l === "ja" ? "Japanese" : "English");

export const transcriptText = (turns: { who: string; text: string }[]) =>
  turns.map((t) => `${t.who}: ${t.text}`).join("\n");
