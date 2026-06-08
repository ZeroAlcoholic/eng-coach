// gemini-3.5-flash text helpers for the coach (all structured JSON output):
//   1. generateScenario  — a brief / pasted Markdown → a structured Scenario
//   2. extractLearnedItems — a finished transcript → LearnedItem[] (the interop
//      unit other tools consume)
//   3. refreshProgressNote — a finished transcript → one-line "what's next"
// These are the only text-model calls; the live voice loop is gemini-direct.ts.

import { GoogleGenAI, Type } from "@google/genai";

import type {
  CEFRLevel,
  LearnedItem,
  Scenario,
  TargetLanguage,
  TranscriptTurn,
} from "../../kernel/types";
import { FRAME_PRESETS } from "./frames";

const TEXT_MODEL = "gemini-3.5-flash";

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

async function generateJson<T>(apiKey: string, prompt: string, schema: unknown): Promise<T> {
  const res = await client(apiKey).models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: schema as object },
  });
  return JSON.parse(res.text ?? "{}") as T;
}

// 1. brief → Scenario ------------------------------------------------------
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

  const gen = await generateJson<Omit<Scenario, "id" | "targetLanguage" | "level" | "baseContext" | "source">>(
    apiKey,
    prompt,
    SCENARIO_SCHEMA,
  );

  return {
    id: crypto.randomUUID(),
    targetLanguage: opts.language,
    level: opts.level,
    baseContext: FRAME_PRESETS[opts.language], // editable Layer-1 preset
    source: opts.brief,
    ...gen,
  };
}

// 2. transcript → LearnedItem[] -------------------------------------------
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

type RawItem = Pick<LearnedItem, "kind" | "text" | "reading" | "meaning" | "example">;

export async function extractLearnedItems(
  apiKey: string,
  opts: { scenario: Scenario; sessionId: string; transcript: TranscriptTurn[] },
): Promise<LearnedItem[]> {
  if (!opts.transcript.length) return [];
  const langName = opts.scenario.targetLanguage === "ja" ? "Japanese" : "English";
  const convo = opts.transcript.map((t) => `${t.who}: ${t.text}`).join("\n");
  const prompt =
    `From this ${langName} practice transcript, list up to 15 notable items the learner ` +
    `encountered or was corrected on: vocabulary (word), useful expressions (phrase), or ` +
    `grammar points (grammar). For each give: kind; text (the item); reading (kana/pinyin ` +
    `if helpful, else ""); meaning in Traditional Chinese; a short example sentence. Skip ` +
    `trivial words.\n\nTRANSCRIPT:\n${convo}`;

  const out = await generateJson<{ items: RawItem[] }>(apiKey, prompt, ITEMS_SCHEMA);
  const now = new Date().toISOString();
  return (out.items ?? []).map((r) => ({
    id: crypto.randomUUID(),
    language: opts.scenario.targetLanguage,
    sourceScenarioId: opts.scenario.id,
    sourceSessionId: opts.sessionId,
    firstSeenAt: now,
    ...r,
  }));
}

// 3. transcript → bilingual review + CEFR + rolling progress note ----------
const REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cefr: { type: Type.STRING }, // estimated CEFR shown this session, e.g. "B1"
    reviewEn: { type: Type.STRING }, // one English sentence of progress review
    reviewZh: { type: Type.STRING }, // one Traditional Chinese sentence
    progressNote: { type: Type.STRING }, // one English sentence: what to work on next
  },
  required: ["cefr", "reviewEn", "reviewZh", "progressNote"],
};

export interface SessionReview {
  cefr: string; // estimated CEFR for this session
  reviewEn: string; // 1-sentence English review
  reviewZh: string; // 1-sentence 繁中 review
  progressNote: string; // fed into the next session's system instruction
}

export async function summariseSession(
  apiKey: string,
  opts: { transcript: TranscriptTurn[]; level: CEFRLevel; previous?: string },
): Promise<SessionReview> {
  const fallback: SessionReview = {
    cefr: opts.level,
    reviewEn: "",
    reviewZh: "",
    progressNote: opts.previous ?? "",
  };
  if (!opts.transcript.length) return fallback;
  const convo = opts.transcript.map((t) => `${t.who}: ${t.text}`).join("\n");
  const prompt =
    `Review this speaking-practice transcript. The learner's target level is CEFR ${opts.level}` +
    `${opts.previous ? ` and the previous note was "${opts.previous}"` : ""}. Return: ` +
    `cefr (your honest CEFR estimate of THIS conversation, e.g. "B1"); reviewEn (ONE encouraging ` +
    `English sentence on how they did); reviewZh (ONE Traditional Chinese sentence, Taiwan ` +
    `colloquial, same gist); progressNote (ONE or two concrete English sentences naming the SPECIFIC ` +
    `things to target next time — e.g. a recurring pronunciation/accent issue, a grammar slip, or a ` +
    `phrase to reuse — so the next session can coach them directly).\n\nTRANSCRIPT:\n${convo}`;
  const out = await generateJson<Partial<SessionReview>>(apiKey, prompt, REVIEW_SCHEMA);
  return { ...fallback, ...out };
}
