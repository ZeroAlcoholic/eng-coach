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
  SessionReview,
  TargetLanguage,
  TranscriptTurn,
} from "../../kernel/types";
import { FRAME_PRESETS } from "./frames";
import { medianReview } from "./progress";

export type { SessionReview };

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

// 3. transcript → end-of-session recap (CEFR + per-skill + wins/fixes/objectives)
// This is the "learning payload": an LLM-as-rubric judge over the stored
// transcript. cefr/subscores use few-shot-free but explicit rubric wording;
// objectivesMet grades the scenario's own objectives.
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
  },
  required: ["cefr", "reviewEn", "reviewZh", "progressNote"],
};

export async function summariseSession(
  apiKey: string,
  opts: { transcript: TranscriptTurn[]; level: CEFRLevel; previous?: string; objectives?: string[] },
): Promise<SessionReview> {
  const fallback: SessionReview = {
    cefr: opts.level,
    reviewEn: "",
    reviewZh: "",
    progressNote: opts.previous ?? "",
  };
  if (!opts.transcript.length) return fallback;
  const convo = opts.transcript.map((t) => `${t.who}: ${t.text}`).join("\n");
  const objectivesBlock = opts.objectives?.length
    ? ` The session objectives were:\n${opts.objectives.map((o) => `- ${o}`).join("\n")}\n` +
      `For objectivesMet, judge each objective above as met true/false from the learner's actual speech.`
    : "";
  const prompt =
    `You are a CEFR speaking examiner. Review this practice transcript; the learner's target level is ` +
    `CEFR ${opts.level}${opts.previous ? ` and the previous note was "${opts.previous}"` : ""}.` +
    objectivesBlock +
    `\nReason from the LEARNER's turns only. Return JSON: cefr (honest CEFR of this session, e.g. "B1"); ` +
    `subscores as integers 1–6 (1=A1 … 6=C2) for grammar, vocab, fluency, interaction; reviewEn (ONE ` +
    `encouraging English sentence); reviewZh (ONE Taiwan-colloquial Traditional Chinese sentence, same ` +
    `gist); wins (1–3 short things they did well); fixes (1–3 short items to fix, each WITH the natural ` +
    `corrected version); progressNote (one or two concrete English sentences naming the specific ` +
    `pronunciation/grammar/phrase points to target next time so the next session can coach them ` +
    `directly).\n\nTRANSCRIPT:\n${convo}`;
  // Self-consistency: sample a few times and median the numeric fields (W2).
  // Tolerant of partial failures — use whatever samples succeed.
  const SAMPLES = 3;
  const results = await Promise.all(
    Array.from({ length: SAMPLES }, () =>
      generateJson<Partial<SessionReview>>(apiKey, prompt, REVIEW_SCHEMA).catch(() => null),
    ),
  );
  const valid = results
    .filter((r): r is Partial<SessionReview> => !!r)
    .map((r) => ({ ...fallback, ...r }) as SessionReview);
  if (!valid.length) return fallback;
  return valid.length >= 2 ? medianReview(valid) : valid[0];
}

// 4. anti-stuck: suggest a few things the learner could say next (W4) ---------
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

export async function suggestReplies(
  apiKey: string,
  opts: { scenario: Scenario; transcript: TranscriptTurn[] },
): Promise<ReplySuggestion[]> {
  const langName = opts.scenario.targetLanguage === "ja" ? "Japanese" : "English";
  const tail = opts.transcript.slice(-6).map((t) => `${t.who}: ${t.text}`).join("\n") || "(just starting)";
  const prompt =
    `The learner is stuck in a ${langName} role-play and needs help knowing what to say next. ` +
    `Given the recent turns, suggest 2–3 SHORT, natural things THEY (the learner) could say next, at ` +
    `CEFR ${opts.scenario.level}.` +
    (opts.scenario.targetLanguage === "ja" ? " For Japanese include kana + romaji in `say`." : "") +
    ` Each item: say (in ${langName}) + gloss (Traditional Chinese meaning).\n\nRECENT:\n${tail}`;
  const out = await generateJson<{ suggestions?: ReplySuggestion[] }>(apiKey, prompt, SUGGEST_SCHEMA);
  return out.suggestions ?? [];
}

// translate one transcript line to Traditional Chinese (W4 tap-to-translate) ---
const TRANSLATE_SCHEMA = {
  type: Type.OBJECT,
  properties: { zh: { type: Type.STRING } },
  required: ["zh"],
};

export async function translateLine(apiKey: string, text: string): Promise<string> {
  if (!text.trim()) return "";
  const out = await generateJson<{ zh?: string }>(
    apiKey,
    `Translate this into natural Traditional Chinese (Taiwan). Return only the translation.\n\n${text}`,
    TRANSLATE_SCHEMA,
  );
  return out.zh ?? "";
}
