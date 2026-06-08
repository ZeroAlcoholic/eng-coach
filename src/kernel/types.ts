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
}

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
  // SRS scheduling, owned by whatever flashcard tool consumes the item. The
  // coach leaves this undefined; a card app fills it in.
  srs?: { due?: string; intervalDays?: number; ease?: number; reps?: number };
  tags?: string[];
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
}

export const DEFAULT_PROFILE: LearnerProfile = { language: "en", level: "B1", focus: [] };
