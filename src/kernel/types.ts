// === The shared data kernel: contracts ===
// Everything lives in the browser. Every static tool in this folder (the coach,
// future flashcard / grammar apps) imports these types and reads/writes the same
// IndexedDB. The LearningPack is the one portable artifact for moving data
// between devices (e.g. via the NAS) or into other systems (Anki/CSV).
// Keep this format stable — it is the contract across all tools.

export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// One proficiency scale for every target language — CEFR is cross-language by
// design. For Japanese the prompt also surfaces the rough JLPT equivalent.
export type TargetLanguage = "en" | "ja";

export const TARGET_LANGUAGES: { id: TargetLanguage; label: string; hint: string }[] = [
  { id: "en", label: "English", hint: "meetings / business" },
  { id: "ja", label: "日本語", hint: "travel" },
];

/**
 * A locked practice context, in TWO layers:
 *   - baseContext (Layer 1): the reusable coaching frame — HOW the coach runs
 *     the practice (a business-meeting role-play, a travel conversation, ...).
 *     Preset per language, editable.
 *   - contentContext (Layer 2): the specific material for THIS scenario — the
 *     meeting data you imported, or the specific place/occasion (this ramen
 *     shop, this hotel check-in). This is the part that changes every time.
 * Both are fed to the live coach's system instruction; the coach must stay
 * inside them and not drift.
 */
export interface Scenario {
  id: string;
  title: string;
  targetLanguage: TargetLanguage;
  level: CEFRLevel; // locked language level — drives difficulty calibration
  baseContext: string; // Layer 1 — coaching frame
  contentContext: string; // Layer 2 — specific material / place / occasion
  coachRole: string; // who the coach plays
  userRole: string; // who the learner plays
  objectives: string[]; // what the learner should get to practise
  targetPhrases: string[]; // expressions/vocab to elicit naturally
  // Lightweight rolling progress — one or two sentences refreshed at the end of
  // each session ("what to work on next"), fed into the next session so the
  // coach picks up where you left off. This is the whole of "progress": no
  // report parsing, no retained eval documents.
  progressNote?: string;
  source?: string; // the original brief/markdown this scenario was built from
  // S1 — set when this scenario IS one episode of a story arc. Absent on every
  // standalone scenario (and on every pack written before S1), so the whole arc
  // feature is additive: nothing reads this unless the scenario opted in.
  arc?: { arcId: string; episode: number };
}

/**
 * S1 — the continuity a story arc carries between episodes. Deliberately three
 * flat lists rather than free prose: each is cheap for the model to update and
 * cheap to feed back in, and「還沒兌現的事」is what makes the learner want the
 * next episode (openThreads IS the narrative hook).
 */
export interface StoryState {
  characters: { name: string; note: string }[]; // who is who (recurring cast)
  events: string[]; // key things that have happened, oldest → newest
  openThreads: string[]; // promises/loose ends not yet paid off → next episode's hook
}

/**
 * S3 — one CEFR can-do the arc teaches, e.g.「能在櫃台說明狀況並要求改班」.
 *
 * The TEXT IS THE IDENTITY and is FIXED when the arc is created: the C1 ledger is
 * keyed by objective text, so regenerating or rewording a can-do mid-arc would
 * fork its mastery row and the accumulated attempts would be lost (this is the
 * exact "objective drift" problem C1 documents). `id` is stable and local to the
 * arc, so an episode can reference a can-do without repeating its prose.
 */
export interface ArcCanDo {
  id: string; // stable within the arc, e.g. "cd1"
  text: string; // the can-do statement, in 繁中 — NEVER rewritten after creation
}

/** One materialised episode of an arc: the Scenario to practise plus its recap. */
export interface ArcEpisode {
  n: number; // 1-based episode number
  scenarioId: string; // the Scenario carrying this episode's context
  title: string;
  recap?: string; // ≤3 繁中 sentences of「前情提要」(episode 1 has none)
  canDoIds?: string[]; // S3 — the 1–2 arc can-dos this episode targets
  completedAt?: string; // ISO — set once a session for this episode is finalised
}

/**
 * S1 — a continuous story line: an ordered list of episodes over a shared,
 * evolving StoryState. The pull is narrative ("what happens next"), never a
 * streak — an arc waits in place indefinitely, exactly like a scenario does.
 *
 * Progress is EPISODE COUNT, never a percentage or a score (no-gamification).
 */
export interface Arc {
  id: string;
  title: string;
  targetLanguage: TargetLanguage;
  level: CEFRLevel;
  premise: string; // the situation the whole arc plays out in
  episodes: ArcEpisode[]; // materialised so far; index order === episode order
  plannedEpisodes: number; // rough length ("第 N／約 M 集"); also the hard cap
  storyState: StoryState;
  // S3 — the arc's syllabus: 6–8 can-dos, fixed at creation. Optional only for
  // backward compatibility with arcs exported before S3.
  canDos?: ArcCanDo[];
  // S4 — an authored beat per episode ("機場報到" → "客戶會議" → …). When present,
  // episode N must play out beat N, so a built-in demo arc follows its designed
  // shape instead of wherever the model drifts. Absent = the model is free.
  outline?: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** How long a built or generated arc runs by default (ROADMAP S4: 各 ≤6 集). */
export const DEFAULT_ARC_LENGTH = 6;

/** Smoothed per-skill level (EWMA), stored as a float on the 1–6 (A1–C2) scale. */
export interface SkillLevels {
  grammar: number;
  vocab: number;
  fluency: number;
  interaction: number;
}

/** The learner's standing settings — defaults applied to new scenarios, plus the
 *  remembered, smoothed ability used to adapt the coach (W1/W3). */
export interface LearnerProfile {
  language: TargetLanguage; // default target language for new scenarios
  level: CEFRLevel; // default level for new scenarios
  focus: string[]; // recurring weakness areas to gently correct
  // W1 — remembered ability per target language. EWMA of session subscores;
  // never overwritten wholesale. Keyed by language so en/ja track separately.
  levels?: Partial<Record<TargetLanguage, SkillLevels>>;
  // W6 — compact history for the trend sparkline (cap ~30 entries / language).
  levelHistory?: Partial<Record<TargetLanguage, { at: string; cefr: string; overall: number }[]>>;
  // W4 — UX preferences.
  prefs?: { slowSpeech?: boolean };
}

export interface TranscriptTurn {
  who: "user" | "coach";
  text: string;
}

/** Per-skill CEFR band as an integer 1–6 (A1=1 … C2=6) — numeric so it can feed
 *  an EWMA level estimate later, while still reading as a CEFR band. */
export interface SkillScores {
  grammar: number;
  vocab: number;
  fluency: number;
  interaction: number;
}

/** End-of-session recap produced by gemini-3.5-flash over the transcript. */
export interface SessionReview {
  cefr: string; // overall CEFR estimate of THIS session, e.g. "B1"
  subscores?: SkillScores;
  reviewEn: string; // 1 encouraging English sentence
  reviewZh: string; // 1 Traditional Chinese (Taiwan) sentence
  progressNote: string; // concrete things to target next time (fed into next prompt)
  wins?: string[]; // what went well
  fixes?: string[]; // top things to fix, with the natural correction
  objectivesMet?: { objective: string; met: boolean }[]; // per scenario objective
}

export interface SessionRecord {
  id: string;
  scenarioId: string;
  startedAt: string; // ISO timestamp
  transcript: TranscriptTurn[];
  review?: SessionReview; // filled in once the end-of-session analysis succeeds
}

/**
 * An in-progress session, persisted incrementally while the learner speaks so a
 * killed tab (mobile browsers reap backgrounded pages) never loses the
 * conversation. Singleton in the kv store; promoted to a SessionRecord on a
 * clean stop, or recovered from Home on next launch.
 */
export interface DraftSession {
  id: string;
  scenarioId: string;
  startedAt: string; // ISO
  transcript: TranscriptTurn[];
}

/**
 * The ECOSYSTEM INTEROP UNIT. The conversation coach extracts these at session
 * end (vocab/phrases/grammar the learner met or was corrected on); other static
 * tools in the same folder (flashcards, grammar drills) read them from the same
 * IndexedDB. Fields are chosen so this maps cleanly onto an SRS card and onto an
 * Anki/CSV export — that is the bridge to other practice systems.
 */
export interface LearnedItem {
  id: string;
  language: TargetLanguage;
  kind: "word" | "phrase" | "grammar";
  text: string; // the item itself, e.g. "lat pulldown" / "〜ていただけますか"
  reading?: string; // kana / pinyin / IPA — for pronunciation drills
  meaning: string; // gloss in the learner's L1 (繁中)
  example?: string; // a usage example, usually the line it appeared in
  sourceScenarioId?: string;
  sourceSessionId?: string;
  firstSeenAt: string; // ISO
  // SRS scheduling (W7). due/intervalDays/reps are the stable interop surface;
  // `fsrs` carries the full serialized ts-fsrs card (dates as ISO strings) so
  // the scheduler can resume exactly. An item with no srs is a NEW card.
  srs?: {
    due?: string;
    intervalDays?: number;
    reps?: number;
    fsrs?: Record<string, unknown>;
  };
  tags?: string[];
}

/**
 * C1 — per-objective mastery ledger. One record per (scenario, objective): the
 * running tally of how the JUDGE has graded that objective across sessions, plus
 * the learner's most recent SELF-assessment (C3). The two together are the
 * calibration signal (do they think they can do what they actually can?).
 *
 * Keyed by `scenarioId::objective` — there is deliberately NO cross-scenario
 * objective identity (objective free-text doesn't survive scenario regeneration;
 * see ROADMAP "Deferred — cross-scenario scheduler"). It accumulates across
 * sessions and is carried in the LearningPack so a backup/restore (or move to a
 * new device) keeps the mastery history AND the learner's self-ratings — the
 * latter can't be reconstructed from session transcripts.
 */
export interface ObjectiveMastery {
  id: string; // `${scenarioId}::${objective}`
  scenarioId: string;
  objective: string;
  attempts: number; // sessions where the judge assessed this objective
  met: number; // of those, how many it graded "met"
  lastMet?: boolean; // the most recent judge verdict
  selfRating?: "no" | "partly" | "yes"; // C3 — most recent learner self-check
  updatedAt: string; // ISO of the most recent change
}

/**
 * The portable "Learning Pack" — the file you export/import and drop on the NAS
 * to move between devices or hand to another tool. A single-scenario pack is the
 * lightweight "progress file"; a full pack carries the whole local-first dataset.
 */
export interface LearningPack {
  version: 1;
  kind: "learning-pack";
  exportedAt: string; // ISO
  profile?: LearnerProfile;
  scenarios: Scenario[];
  items: LearnedItem[];
  sessions?: SessionRecord[];
  objectives?: ObjectiveMastery[]; // C1 ledger — optional; older packs simply omit it
  arcs?: Arc[]; // S1 story arcs — optional; older packs simply omit it
}

export const DEFAULT_PROFILE: LearnerProfile = { language: "en", level: "B1", focus: [] };
