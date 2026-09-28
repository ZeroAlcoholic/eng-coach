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
  const text = res.text ?? "";
  if (!text) {
    // Empty text has a reason worth showing: a safety block or a truncated
    // candidate is something the user can act on; "not JSON" is not.
    const block = res.promptFeedback?.blockReason;
    const finish = res.candidates?.[0]?.finishReason;
    throw new Invalid("$", block ? `模型拒絕回應（${block}）` : finish ? `模型沒有回傳內容（${finish}）` : "模型沒有回傳內容");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Invalid("$", "model response was not JSON");
  }
  return parse(raw, "$");
}

// The brief is often the Markdown answer to ../briefPrompt.ts pasted back from
// another assistant. Its sections are the learner's own facts and plan; a model
// left to "extract" freely would paraphrase them away, or answer the chat
// wrapper instead of the brief.
export const BRIEF_RULES =
  `The brief may be free text, or a structured Markdown brief (sections such as 情境 / ` +
  `材料重點 / 角色 / 這次要練的事 / 對方可能會問的問題 / 可能用到的句子), possibly wrapped in a ` +
  `chat assistant's preamble or code fences — ignore any wrapper. When the brief provides a ` +
  `section, USE it instead of inventing: keep its roles, names, facts and numbers, and take the ` +
  `objectives and phrases from it. If it lists questions the other side may ask, or the material ` +
  `is a presentation, report or proposal the learner has to explain, write contentContext so the ` +
  `coach, in role, asks those questions one at a time about the material's key facts (quote the ` +
  `facts the questions depend on), and make answering them one of the objectives.`;

export const langName = (l: "en" | "ja") => (l === "ja" ? "Japanese" : "English");

export const transcriptText = (turns: { who: string; text: string }[]) =>
  turns.map((t) => `${t.who}: ${t.text}`).join("\n");
