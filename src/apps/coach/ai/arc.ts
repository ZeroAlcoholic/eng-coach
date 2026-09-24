// Capability (S1): story arcs — seed an arc, and grow it one episode at a time.
// Both calls return the SAME two things: the updated StoryState (the continuity
// carried between episodes) and the next episode's material. The arc domain
// (../arcs.ts) bounds and normalises the content further; here the SHAPE is
// enforced so a malformed response is refused rather than half-stored.

import { Type } from "@google/genai";

import type { Arc, ArcEpisode, CEFRLevel, Scenario, StoryState, TargetLanguage, TranscriptTurn } from "../../../kernel/types";
import {
  arrayKeeping,
  arrayOf,
  field,
  nonEmptyString,
  number,
  optional,
  record,
  string,
  type Parser,
} from "../../../kernel/validate";
import { generateJson, langName, transcriptText } from "./client";

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
  required: ["title", "contentContext", "coachRole", "userRole", "objectives", "targetPhrases", "recap", "canDoIndexes"],
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

export interface ArcSeed extends EpisodeGeneration {
  arcTitle: string;
  premise: string;
  canDos: string[]; // S3 — 6–8 can-do statements, fixed from here on
  outline: string[]; // S4 — one beat per planned episode
}

const parseStoryState: Parser<StoryState> = (v, path) => {
  const r = record(v, path);
  const character: Parser<StoryState["characters"][number]> = (c, p) => {
    const cr = record(c, p);
    return { name: field(cr, "name", nonEmptyString, p), note: field(cr, "note", string, p) };
  };
  return {
    characters: field(r, "characters", arrayKeeping(character), path),
    events: field(r, "events", arrayKeeping(nonEmptyString), path),
    openThreads: field(r, "openThreads", arrayKeeping(nonEmptyString), path),
  };
};

const parseEpisodeDraft: Parser<EpisodeDraft> = (v, path) => {
  const r = record(v, path);
  return {
    title: field(r, "title", nonEmptyString, path),
    contentContext: field(r, "contentContext", nonEmptyString, path),
    coachRole: field(r, "coachRole", nonEmptyString, path),
    userRole: field(r, "userRole", nonEmptyString, path),
    objectives: field(r, "objectives", arrayKeeping(nonEmptyString), path),
    targetPhrases: field(r, "targetPhrases", arrayKeeping(nonEmptyString), path),
    recap: field(r, "recap", optional(string), path) ?? "",
    canDoIndexes: field(r, "canDoIndexes", optional(arrayKeeping(number)), path) ?? [],
  };
};

export const parseEpisodeGeneration: Parser<EpisodeGeneration> = (v, path) => {
  const r = record(v, path);
  return {
    storyState: field(r, "storyState", parseStoryState, path),
    episode: field(r, "episode", parseEpisodeDraft, path),
  };
};

export const parseArcSeed: Parser<ArcSeed> = (v, path) => {
  const r = record(v, path);
  return {
    ...parseEpisodeGeneration(v, path),
    arcTitle: field(r, "arcTitle", nonEmptyString, path),
    premise: field(r, "premise", nonEmptyString, path),
    canDos: field(r, "canDos", arrayOf(nonEmptyString), path),
    outline: field(r, "outline", arrayKeeping(nonEmptyString), path),
  };
};

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

const NEXT_EPISODE_SCHEMA = {
  type: Type.OBJECT,
  properties: { storyState: STORY_STATE_SCHEMA, episode: EPISODE_SCHEMA },
  required: ["storyState", "episode"],
};

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
  return generateJson(apiKey, prompt, ARC_SEED_SCHEMA, parseArcSeed);
}

export async function generateNextEpisode(
  apiKey: string,
  opts: { arc: Arc; lastEpisode: ArcEpisode; lastScenario: Scenario; transcript: TranscriptTurn[] },
): Promise<EpisodeGeneration> {
  const { arc, lastEpisode } = opts;
  const nextN = lastEpisode.n + 1;
  const state = arc.storyState;
  const convo = opts.transcript.length
    ? transcriptText(opts.transcript).slice(-6000)
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
  return generateJson(apiKey, prompt, NEXT_EPISODE_SCHEMA, parseEpisodeGeneration);
}
