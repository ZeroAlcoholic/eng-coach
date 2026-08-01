// S1 — story arcs: the continuity layer over scenarios.
//
// An arc is an ordered list of EPISODES, each episode being an ordinary Scenario
// tagged with `arc: {arcId, episode}`, over one shared StoryState that the model
// rewrites at the end of every episode. Nothing else in the app changes: an
// episode is practised, judged, and reviewed exactly like any other scenario.
//
// The invariants this module owns:
//   1. AT MOST ONE pending (un-played) episode exists at a time — that episode IS
//      「下一集」. No pending episode + room left = one needs generating.
//   2. Materialising an episode writes the arc and its Scenario ATOMICALLY
//      (db.putArcWithScenario), so an episode can never point at a missing
//      scenario. A failed generation leaves the arc byte-identical → retryable.
//   3. Growing an arc is IDEMPOTENT and single-flight: calling advanceArc twice
//      (Home's button + the end-of-episode pre-generate) yields one episode.
//   4. StoryState is bounded, so a 6-episode arc can't grow an unbounded prompt.

import {
  getArc,
  getScenario,
  listSessionsFor,
  putArc,
  putArcWithScenario,
} from "../../kernel/db";
import type {
  Arc,
  ArcEpisode,
  CEFRLevel,
  Scenario,
  StoryState,
  TargetLanguage,
  TranscriptTurn,
} from "../../kernel/types";
import { DEFAULT_ARC_LENGTH } from "../../kernel/types";
import {
  generateArcSeed,
  generateNextEpisode,
  type ArcSeed,
  type EpisodeDraft,
  type EpisodeGeneration,
} from "./ai";
import { FRAME_PRESETS } from "./frames";

/** ROADMAP S2 guard:「前情提要 ≤3 句」— enforced here, never trusted to the model. */
export const MAX_RECAP_SENTENCES = 3;

// Bounds on the carried state: enough continuity to feel like one story, small
// enough that episode 6's prompt is no larger than episode 2's.
const MAX_CHARACTERS = 8;
const MAX_EVENTS = 20;
const MAX_OPEN_THREADS = 5;

// --- selectors (pure) -------------------------------------------------------

/** The episode waiting to be practised — 「下一集」. Undefined = one is needed. */
export function pendingEpisode(arc: Arc): ArcEpisode | undefined {
  return arc.episodes.find((e) => !e.completedAt);
}

export function playedCount(arc: Arc): number {
  return arc.episodes.filter((e) => e.completedAt).length;
}

/** Episode number 「下一集」 will carry — 1-based, whether or not it exists yet. */
export function nextEpisodeNumber(arc: Arc): number {
  return pendingEpisode(arc)?.n ?? arc.episodes.length + 1;
}

/** Every episode played and no room for another — the story is over. */
export function isArcFinished(arc: Arc): boolean {
  return !pendingEpisode(arc) && arc.episodes.length >= arc.plannedEpisodes;
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}

function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().match(/[^。！？!?]+[。！？!?]?/g) ?? [];
}

/** Keep the first `max` sentences. Chinese and ASCII terminators both count.
 *  A space after a full-width terminator is an artefact of flattening the model's
 *  line breaks — drop it, while leaving normal English spacing alone. */
export function clampRecap(text: string, max = MAX_RECAP_SENTENCES): string {
  return splitSentences(text ?? "")
    .slice(0, max)
    .join("")
    .replace(/([。！？])\s+/g, "$1")
    .trim();
}

// --- normalisation ----------------------------------------------------------

const flat = (s: unknown, cap: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);

/** Model output is untrusted prose: flatten, trim, drop empties, and BOUND it. */
export function normaliseStoryState(raw: Partial<StoryState> | undefined): StoryState {
  const characters = (raw?.characters ?? [])
    .map((c) => ({ name: flat(c?.name, 60), note: flat(c?.note, 160) }))
    .filter((c) => c.name)
    .slice(0, MAX_CHARACTERS);
  const events = (raw?.events ?? [])
    .map((e) => flat(e, 200))
    .filter(Boolean)
    .slice(-MAX_EVENTS); // newest kept — the tail is what the next episode follows on from
  const openThreads = (raw?.openThreads ?? [])
    .map((t) => flat(t, 200))
    .filter(Boolean)
    .slice(0, MAX_OPEN_THREADS);
  return { characters, events, openThreads };
}

function cleanLines(xs: string[] | undefined, cap: number, max: number): string[] {
  return (xs ?? []).map((x) => flat(x, cap)).filter(Boolean).slice(0, max);
}

/** An episode draft → the Scenario the live coach actually runs. */
function episodeScenario(
  arc: Arc,
  draft: EpisodeDraft,
  n: number,
  previous?: Scenario,
): Scenario {
  return {
    id: crypto.randomUUID(),
    title: flat(draft.title, 120) || `${arc.title} 第 ${n} 集`,
    targetLanguage: arc.targetLanguage,
    level: arc.level,
    // Inherit the previous episode's Layer-1 frame so a user's edit to it carries
    // through the rest of the story; fall back to the language preset.
    baseContext: previous?.baseContext ?? FRAME_PRESETS[arc.targetLanguage],
    contentContext: String(draft.contentContext ?? "").trim(),
    coachRole: flat(draft.coachRole, 200),
    userRole: flat(draft.userRole, 200),
    objectives: cleanLines(draft.objectives, 200, 6),
    targetPhrases: cleanLines(draft.targetPhrases, 120, 12),
    // Coaching continuity: each episode is a NEW scenario, so without this the
    // rolling「下次重點」would reset every episode.
    progressNote: previous?.progressNote,
    arc: { arcId: arc.id, episode: n },
  };
}

// --- writes -----------------------------------------------------------------

/** Injected so the failure path is testable without breaking the network. */
export type SeedGenerator = (opts: {
  brief: string;
  language: TargetLanguage;
  level: CEFRLevel;
  episodes: number;
}) => Promise<ArcSeed>;

export type NextEpisodeGenerator = (opts: {
  arc: Arc;
  lastEpisode: ArcEpisode;
  lastScenario: Scenario;
  transcript: TranscriptTurn[];
}) => Promise<EpisodeGeneration>;

export interface ArcStart {
  arc: Arc;
  scenario: Scenario; // episode 1, ready to practise
}

/** Create an arc from a brief, with episode 1 materialised and ready. */
export async function startArc(
  opts: {
    brief: string;
    language: TargetLanguage;
    level: CEFRLevel;
    episodes?: number;
    now?: string;
  },
  generate: SeedGenerator,
): Promise<ArcStart> {
  const episodes = clampLength(opts.episodes ?? DEFAULT_ARC_LENGTH);
  const seed = await generate({
    brief: opts.brief,
    language: opts.language,
    level: opts.level,
    episodes,
  });
  const at = opts.now ?? new Date().toISOString();
  const arcId = crypto.randomUUID();
  const arc: Arc = {
    id: arcId,
    title: flat(seed.arcTitle, 120) || "連續故事",
    targetLanguage: opts.language,
    level: opts.level,
    premise: String(seed.premise ?? "").trim(),
    episodes: [],
    plannedEpisodes: episodes,
    storyState: normaliseStoryState(seed.storyState),
    createdAt: at,
    updatedAt: at,
  };
  const scenario = episodeScenario(arc, seed.episode, 1);
  arc.episodes = [
    { n: 1, scenarioId: scenario.id, title: scenario.title, recap: clampRecap(seed.episode.recap) },
  ];
  await putArcWithScenario(arc, scenario);
  return { arc, scenario };
}

function clampLength(n: number): number {
  return Math.min(Math.max(Math.round(n) || DEFAULT_ARC_LENGTH, 2), DEFAULT_ARC_LENGTH);
}

/**
 * Record that an episode was practised. Idempotent: a re-finalised session (draft
 * recovery runs the same pipeline) must not move the story twice.
 */
export async function markEpisodePlayed(
  arcId: string,
  episode: number,
  at: string,
): Promise<void> {
  const arc = await getArc(arcId);
  if (!arc) return;
  const target = arc.episodes.find((e) => e.n === episode);
  if (!target || target.completedAt) return;
  await putArc({
    ...arc,
    episodes: arc.episodes.map((e) => (e.n === episode ? { ...e, completedAt: at } : e)),
    updatedAt: at,
  });
}

// Single-flight per arc: the end-of-episode pre-generate and a tap on「下一集」
// can land together, and each costs a model call plus a write. Both callers must
// observe the SAME outcome, so they share one in-flight promise.
const inFlight = new Map<string, Promise<Scenario | null>>();

/**
 * Ensure the arc has an episode ready to practise, and return it.
 *
 * Idempotent by design — a no-op read when 「下一集」 already exists. Returns null
 * when the arc has run its course. THROWS on generation/write failure, leaving the
 * arc untouched; callers decide whether that's fatal (a tap on 下一集 → tell the
 * user, they can tap again) or best-effort (end-of-episode pre-generate → warn).
 */
export function advanceArc(
  arcId: string,
  generate: NextEpisodeGenerator,
  now?: string,
): Promise<Scenario | null> {
  const existing = inFlight.get(arcId);
  if (existing) return existing;
  const task = grow(arcId, generate, now).finally(() => inFlight.delete(arcId));
  inFlight.set(arcId, task);
  return task;
}

async function grow(
  arcId: string,
  generate: NextEpisodeGenerator,
  now?: string,
): Promise<Scenario | null> {
  const arc = await getArc(arcId);
  if (!arc) return null;

  // Already ready — the common path, and the reason this is safe to call freely.
  const pending = pendingEpisode(arc);
  if (pending) return (await getScenario(pending.scenarioId)) ?? null;
  if (arc.episodes.length >= arc.plannedEpisodes) return null; // story complete

  const last = arc.episodes[arc.episodes.length - 1];
  if (!last) return null; // an arc with no episodes at all: nothing to follow on from
  const lastScenario = await getScenario(last.scenarioId);
  if (!lastScenario) return null; // its scenario was deleted — don't invent continuity

  const sessions = await listSessionsFor(last.scenarioId);
  const transcript: TranscriptTurn[] = sessions[0]?.transcript ?? [];
  const out = await generate({ arc, lastEpisode: last, lastScenario, transcript });

  const n = last.n + 1;
  const scenario = episodeScenario(arc, out.episode, n, lastScenario);
  const at = now ?? new Date().toISOString();
  const updated: Arc = {
    ...arc,
    storyState: normaliseStoryState(out.storyState),
    episodes: [
      ...arc.episodes,
      { n, scenarioId: scenario.id, title: scenario.title, recap: clampRecap(out.episode.recap) },
    ],
    updatedAt: at,
  };
  await putArcWithScenario(updated, scenario);
  return scenario;
}

// --- production wiring (the injected generators, bound to a key) -------------

export const seedGenerator = (apiKey: string): SeedGenerator => (opts) =>
  generateArcSeed(apiKey, opts);

export const nextEpisodeGenerator = (apiKey: string): NextEpisodeGenerator => (opts) =>
  generateNextEpisode(apiKey, opts);
