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
  ArcCanDo,
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

// S3 — syllabus size (ROADMAP:「每組 6–8 個 can-do」/「每集鎖定 1–2 個」).
const MIN_CAN_DOS = 6;
const MAX_CAN_DOS = 8;
const MAX_CAN_DOS_PER_EPISODE = 2;

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

/** S3 — the can-dos one episode targets, resolved from the arc's FIXED list. */
export function episodeCanDos(arc: Arc, episode: ArcEpisode | undefined): ArcCanDo[] {
  if (!episode?.canDoIds?.length || !arc.canDos?.length) return [];
  const byId = new Map(arc.canDos.map((c) => [c.id, c]));
  return episode.canDoIds.map((id) => byId.get(id)).filter((c): c is ArcCanDo => !!c);
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

/**
 * S3 — freeze the arc's syllabus. Ids are positional (`cd1`…) and the text is
 * never touched again: the C1 ledger keys on the text, so any later rewording
 * would fork the mastery row. Deduped, so a repeated statement can't occupy two
 * slots. Returns undefined when the source gives nothing usable — an arc without
 * a syllabus still works, it just has no can-do line.
 */
export function freezeCanDos(texts: string[] | undefined): ArcCanDo[] | undefined {
  const seen = new Set<string>();
  const out: ArcCanDo[] = [];
  for (const t of texts ?? []) {
    const text = flat(t, 200);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ id: `cd${out.length + 1}`, text });
    if (out.length === MAX_CAN_DOS) break;
  }
  return out.length ? out : undefined;
}

/** Whether a frozen syllabus is the size ROADMAP S3 asks for (6–8). */
export function hasFullSyllabus(arc: Arc): boolean {
  const n = arc.canDos?.length ?? 0;
  return n >= MIN_CAN_DOS && n <= MAX_CAN_DOS;
}

/**
 * S3 — model-chosen 1-based positions → can-do ids. Out-of-range, duplicate and
 * non-integer picks are dropped rather than invented, and at most 2 survive.
 */
export function resolveCanDoIds(canDos: ArcCanDo[] | undefined, indexes: unknown): string[] {
  if (!canDos?.length || !Array.isArray(indexes)) return [];
  const picked: string[] = [];
  for (const raw of indexes) {
    const i = Math.trunc(Number(raw));
    const canDo = Number.isFinite(i) ? canDos[i - 1] : undefined;
    if (!canDo || picked.includes(canDo.id)) continue;
    picked.push(canDo.id);
    if (picked.length === MAX_CAN_DOS_PER_EPISODE) break;
  }
  return picked;
}

/** An episode draft → the Scenario the live coach actually runs.
 *
 *  S3: the episode's can-do statements are appended to `objectives`, which is
 *  what makes the syllabus real rather than decorative — the live prompt steers
 *  toward objectives and the end-of-session judge grades them one by one, so the
 *  can-dos ride the machinery that already exists instead of a parallel one. */
function episodeScenario(
  arc: Arc,
  draft: EpisodeDraft,
  n: number,
  canDoIds: string[],
  previous?: Scenario,
  scenarioId?: string,
): Scenario {
  const canDoTexts = episodeCanDos(arc, { n, scenarioId: "", title: "", canDoIds }).map((c) => c.text);
  const objectives = [...cleanLines(draft.objectives, 200, 6)];
  for (const text of canDoTexts) if (!objectives.includes(text)) objectives.push(text);
  return {
    id: scenarioId ?? crypto.randomUUID(),
    title: flat(draft.title, 120) || `${arc.title} 第 ${n} 集`,
    targetLanguage: arc.targetLanguage,
    level: arc.level,
    // Inherit the previous episode's Layer-1 frame so a user's edit to it carries
    // through the rest of the story; fall back to the language preset.
    baseContext: previous?.baseContext ?? FRAME_PRESETS[arc.targetLanguage],
    contentContext: String(draft.contentContext ?? "").trim(),
    coachRole: flat(draft.coachRole, 200),
    userRole: flat(draft.userRole, 200),
    objectives,
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
    canDos: freezeCanDos(seed.canDos),
    outline: cleanLines(seed.outline, 200, episodes),
    createdAt: at,
    updatedAt: at,
  };
  const canDoIds = resolveCanDoIds(arc.canDos, seed.episode.canDoIndexes);
  const scenario = episodeScenario(arc, seed.episode, 1, canDoIds);
  arc.episodes = [
    {
      n: 1,
      scenarioId: scenario.id,
      title: scenario.title,
      recap: clampRecap(seed.episode.recap),
      canDoIds,
    },
  ];
  await putArcWithScenario(arc, scenario);
  return { arc, scenario };
}

/**
 * S4 — a built-in demo arc: everything episode 1 needs is AUTHORED, so installing
 * one costs zero API calls and works offline. Episodes 2+ are generated on the
 * normal path, kept on rails by `outline`.
 */
export interface DemoArc {
  id: string; // stable — re-installing overwrites rather than duplicating
  title: string;
  targetLanguage: TargetLanguage;
  level: CEFRLevel;
  premise: string;
  plannedEpisodes: number;
  canDos: string[]; // 6–8, frozen on install
  outline: string[]; // one beat per episode
  storyState: StoryState; // the shared seed every episode builds on
  episode1: EpisodeDraft;
}

/**
 * Install (or reset) a demo arc under its stable id. Idempotent by construction:
 * both the arc id and episode 1's scenario id are derived from the demo's id, so
 * running this twice leaves exactly ONE arc and ONE episode-1 scenario.
 */
export async function installDemoArc(demo: DemoArc, now?: string): Promise<ArcStart> {
  const at = now ?? new Date().toISOString();
  const arc: Arc = {
    id: demo.id,
    title: demo.title,
    targetLanguage: demo.targetLanguage,
    level: demo.level,
    premise: demo.premise,
    episodes: [],
    plannedEpisodes: clampLength(demo.plannedEpisodes),
    storyState: normaliseStoryState(demo.storyState),
    canDos: freezeCanDos(demo.canDos),
    outline: cleanLines(demo.outline, 200, demo.plannedEpisodes),
    createdAt: at,
    updatedAt: at,
  };
  const canDoIds = resolveCanDoIds(arc.canDos, demo.episode1.canDoIndexes);
  const scenario = episodeScenario(arc, demo.episode1, 1, canDoIds, undefined, `${demo.id}-ep1`);
  arc.episodes = [
    {
      n: 1,
      scenarioId: scenario.id,
      title: scenario.title,
      recap: clampRecap(demo.episode1.recap),
      canDoIds,
    },
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
  // S3 — the syllabus is frozen at creation: the model only PICKS from it here.
  const canDoIds = resolveCanDoIds(arc.canDos, out.episode.canDoIndexes);
  const scenario = episodeScenario(arc, out.episode, n, canDoIds, lastScenario);
  const at = now ?? new Date().toISOString();
  const updated: Arc = {
    ...arc,
    storyState: normaliseStoryState(out.storyState),
    episodes: [
      ...arc.episodes,
      {
        n,
        scenarioId: scenario.id,
        title: scenario.title,
        recap: clampRecap(out.episode.recap),
        canDoIds,
      },
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
