// gemini-3.5-flash text helpers for the coach (all structured JSON output):
//   1. generateScenario  — a brief / pasted Markdown → a structured Scenario
//   2. extractLearnedItems — a finished transcript → LearnedItem[] (the interop
//      unit other tools consume)
//   3. refreshProgressNote — a finished transcript → one-line "what's next"
// These are the only text-model calls; the live voice loop is gemini-direct.ts.

import { GoogleGenAI, Type } from "@google/genai";

import { ERROR_TYPES } from "../../kernel/types";
import type {
  Arc,
  ArcEpisode,
  CEFRLevel,
  LearnedItem,
  Scenario,
  SessionReview,
  StoryState,
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

// Cheapest possible liveness probe for a pasted key: models.list is a GET that
// costs no tokens. A typo'd key must fail HERE, at save time, not minutes later
// mid-practice with a raw English error.
export async function validateApiKey(apiKey: string): Promise<void> {
  await client(apiKey).models.list({ config: { pageSize: 1 } });
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
    // E1 — typed errors. `type` is constrained by the schema AND re-validated in
    // code, because a model can still return a plausible-looking unknown label.
    errors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: [...ERROR_TYPES] },
          example: { type: Type.STRING },
          correction: { type: Type.STRING },
        },
        required: ["type", "example", "correction"],
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
    `directly); errors (E1 — up to 3 error PATTERNS in the learner's speech, each as: type, chosen ` +
    `ONLY from this closed list [${ERROR_TYPES.join(", ")}]; example, the learner's own words ` +
    `verbatim; correction, the natural version. Report a pattern only if you can point at a real ` +
    `slip in the transcript — return an empty list rather than inventing one).` +
    `\n\nTRANSCRIPT:\n${convo}`;
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
  // ALWAYS merge, even for a single surviving sample. medianReview is a no-op on
  // the numbers when there is one, but it is also the only place E1's error vote
  // runs — returning valid[0] directly would let one noisy read put an error type
  // into the permanent tally, which is exactly what the vote exists to stop (and
  // one surviving sample is a realistic case: two throttled calls out of three).
  return medianReview(valid);
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

// 6. S1 — story arcs: seed an arc, and grow it one episode at a time -----------
// Both calls return the SAME two things: the updated StoryState (the continuity
// carried between episodes) and the next episode's material. The seed call has no
// transcript to reason from; the next-episode call does.

const STORY_STATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, note: { type: Type.STRING } },
        required: ["name", "note"],
      },
    },
    events: { type: Type.ARRAY, items: { type: Type.STRING } },
    openThreads: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["characters", "events", "openThreads"],
};

const EPISODE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    contentContext: { type: Type.STRING },
    coachRole: { type: Type.STRING },
    userRole: { type: Type.STRING },
    objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
    targetPhrases: { type: Type.ARRAY, items: { type: Type.STRING } },
    recap: { type: Type.STRING },
    canDoIndexes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
  },
  required: [
    "title",
    "contentContext",
    "coachRole",
    "userRole",
    "objectives",
    "targetPhrases",
    "recap",
    "canDoIndexes",
  ],
};

/** One episode's raw material, before it becomes a Scenario. */
export interface EpisodeDraft {
  title: string;
  contentContext: string;
  coachRole: string;
  userRole: string;
  objectives: string[];
  targetPhrases: string[];
  recap: string; // 繁中「前情提要」— clamped to ≤3 sentences by the arc domain
  canDoIndexes: number[]; // S3 — 1-based refs into the arc's FIXED can-do list
}

/** What every arc-growing call returns: where the story now stands + what's next. */
export interface EpisodeGeneration {
  storyState: StoryState;
  episode: EpisodeDraft;
}

const ARC_SEED_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    arcTitle: { type: Type.STRING },
    premise: { type: Type.STRING },
    canDos: { type: Type.ARRAY, items: { type: Type.STRING } },
    outline: { type: Type.ARRAY, items: { type: Type.STRING } },
    storyState: STORY_STATE_SCHEMA,
    episode: EPISODE_SCHEMA,
  },
  required: ["arcTitle", "premise", "canDos", "outline", "storyState", "episode"],
};

export interface ArcSeed extends EpisodeGeneration {
  arcTitle: string;
  premise: string;
  canDos: string[]; // S3 — 6–8 can-do statements, fixed from here on
  outline: string[]; // S4 — one beat per planned episode
}

const langName = (l: TargetLanguage) => (l === "ja" ? "Japanese" : "English");

// Shared rules, so a seeded episode and a generated one read the same way.
const EPISODE_RULES =
  `An EPISODE is ONE ~10-minute spoken practice scene, not a whole story. Give it a ` +
  `concrete place, a concrete reason to talk, and a small outcome to reach. Fields:\n` +
  `- title: short, concrete, and it should make the learner curious.\n` +
  `- contentContext: the vivid, SPECIFIC situation this episode happens in, written so a ` +
  `voice coach can run it without further explanation. Name the recurring characters.\n` +
  `- coachRole / userRole: who each side plays (keep recurring characters consistent).\n` +
  `- objectives: 3-5 observable task outcomes for THIS episode.\n` +
  `- targetPhrases: 5-10 liftable expressions this episode naturally needs.\n` +
  `- recap: AT MOST 3 short sentences of Traditional Chinese (Taiwan) 前情提要 that remind ` +
  `the learner what happened before and what's at stake now. For a first episode, instead ` +
  `set the scene in at most 2 sentences. Never mention episode numbers.`;

export async function generateArcSeed(
  apiKey: string,
  opts: { brief: string; language: TargetLanguage; level: CEFRLevel; episodes: number },
): Promise<ArcSeed> {
  const prompt =
    `Design a CONTINUOUS ${langName(opts.language)} speaking-practice story arc for a Taiwanese ` +
    `learner at CEFR ${opts.level}, based on the brief below. The arc runs about ${opts.episodes} ` +
    `episodes: one connected story with recurring characters, where each episode is a separate ` +
    `conversation that moves the story forward.\n\n` +
    `Return:\n` +
    `- arcTitle (short).\n` +
    `- premise: 2-3 sentences describing the whole arc's situation and where it is heading.\n` +
    `- canDos: the arc's SYLLABUS — 6 to 8 CEFR-style can-do statements written in Traditional ` +
    `Chinese (Taiwan), each starting「能…」and naming an observable speaking ability at CEFR ` +
    `${opts.level} that this story naturally trains (e.g.「能向櫃台說明狀況並要求具體補救」). ` +
    `They must be distinct from one another and cover the whole arc, not just episode 1.\n` +
    `- outline: exactly ${opts.episodes} short beats, one per episode, in order — the shape of ` +
    `the story from start to resolution.\n` +
    `- storyState: characters (the recurring cast, name + one-line note), events (leave EMPTY — ` +
    `nothing has happened yet), openThreads (1-3 things already hanging over the learner that ` +
    `episode 1 will start paying off).\n` +
    `- episode: the FIRST episode, playing out outline beat 1.\n\n` +
    EPISODE_RULES +
    `\n- canDoIndexes: the 1 or 2 canDos this episode targets, as 1-based positions in the canDos ` +
    `list you just returned.` +
    `\n\nBRIEF:\n${opts.brief}`;
  return generateJson<ArcSeed>(apiKey, prompt, ARC_SEED_SCHEMA);
}

const NEXT_EPISODE_SCHEMA = {
  type: Type.OBJECT,
  properties: { storyState: STORY_STATE_SCHEMA, episode: EPISODE_SCHEMA },
  required: ["storyState", "episode"],
};

export async function generateNextEpisode(
  apiKey: string,
  opts: {
    arc: Arc;
    lastEpisode: ArcEpisode;
    lastScenario: Scenario;
    transcript: TranscriptTurn[];
  },
): Promise<EpisodeGeneration> {
  const { arc, lastEpisode } = opts;
  const nextN = lastEpisode.n + 1;
  const state = arc.storyState;
  const convo = opts.transcript.length
    ? opts.transcript.map((t) => `${t.who}: ${t.text}`).join("\n").slice(-6000)
    : "(the learner practised this episode but no transcript was kept)";
  const prompt =
    `You are writing the next episode of a continuous ${langName(arc.targetLanguage)} ` +
    `speaking-practice story for a Taiwanese learner at CEFR ${arc.level}.\n\n` +
    `ARC: ${arc.title}\nPREMISE: ${arc.premise}\n` +
    `This is episode ${nextN} of about ${arc.plannedEpisodes}.\n\n` +
    `STORY SO FAR\n- characters: ${state.characters.map((c) => `${c.name} (${c.note})`).join("; ") || "(none yet)"}\n` +
    `- events: ${state.events.join("; ") || "(none yet)"}\n` +
    `- open threads: ${state.openThreads.join("; ") || "(none)"}\n\n` +
    `JUST PLAYED — episode ${lastEpisode.n}: ${lastEpisode.title}\n${opts.lastScenario.contentContext}\n\n` +
    `TRANSCRIPT OF THAT EPISODE\n${convo}\n\n` +
    // S4 — a built-in arc is authored as a shape; episode N must play beat N.
    (arc.outline?.[nextN - 1]
      ? `THE BEAT EPISODE ${nextN} MUST PLAY (this is fixed — build the episode around it):\n` +
        `${arc.outline[nextN - 1]}\n` +
        (arc.outline[nextN]
          ? `(for context only, do NOT play it yet — episode ${nextN + 1} will be: ${arc.outline[nextN]})\n`
          : "") +
        "\n"
      : "") +
    // S3 — the syllabus is FIXED; the model picks from it, never rewrites it.
    (arc.canDos?.length
      ? `THE ARC'S FIXED CAN-DO LIST (choose from these by position; never reword them):\n` +
        arc.canDos.map((c, i) => `${i + 1}. ${c.text}`).join("\n") +
        `\n\n`
      : "") +
    `Return TWO things.\n` +
    `1. storyState — the story state UPDATED for what actually happened in that transcript: keep ` +
    `and extend characters; APPEND the key events of that episode to the existing events (keep the ` +
    `earlier ones, oldest first); rewrite openThreads to what is now unresolved. Base the events on ` +
    `what the LEARNER actually did and said, not on what was planned.\n` +
    `2. episode — episode ${nextN}, which must FOLLOW ON from those events, pay off or deepen at ` +
    `least one open thread, and reuse at least one recurring character.` +
    (nextN >= arc.plannedEpisodes
      ? ` This is the FINAL episode: resolve the main open threads and bring the story to a close.`
      : ` Leave a new hook open at the end so the learner wants the next episode.`) +
    `\n\n` +
    EPISODE_RULES +
    (arc.canDos?.length
      ? `\n- canDoIndexes: the 1 or 2 can-dos from the FIXED list above that this episode targets, ` +
        `as 1-based positions. Prefer ones earlier episodes haven't covered yet.`
      : `\n- canDoIndexes: return an empty array.`);
  return generateJson<EpisodeGeneration>(apiKey, prompt, NEXT_EPISODE_SCHEMA);
}

// 7. E3 — review extras for ONE item: a cloze sentence (only when the item's own
// example can't supply one) and 2–3 collocations.
//
// Deliberately NO multiple-choice distractors. Generated distractors are wrong
// about half the time in a way the learner can't detect, which teaches the wrong
// form — the ROADMAP flagged exactly this. Recall-then-reveal needs no options, so
// the failure mode is designed out instead of mitigated.
const REVIEW_EXTRAS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cloze: { type: Type.STRING },
    collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["cloze", "collocations"],
};

export interface ReviewExtras {
  cloze: string; // one sentence with the item replaced by the blank token
  collocations: string[]; // 2–3 natural partners, target language
}

export async function generateReviewExtras(
  apiKey: string,
  opts: { item: LearnedItem; blank: string },
): Promise<ReviewExtras> {
  const lang = langName(opts.item.language);
  const out = await generateJson<Partial<ReviewExtras>>(
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
  );
  return {
    cloze: (out.cloze ?? "").trim(),
    collocations: (out.collocations ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 3),
  };
}

export async function translateLine(apiKey: string, text: string): Promise<string> {
  if (!text.trim()) return "";
  const out = await generateJson<{ zh?: string }>(
    apiKey,
    `Translate this into natural Traditional Chinese (Taiwan). Return only the translation.\n\n${text}`,
    TRANSLATE_SCHEMA,
  );
  return out.zh ?? "";
}
