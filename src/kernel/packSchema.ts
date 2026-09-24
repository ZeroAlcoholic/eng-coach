// The LearningPack validator. A pack is a hand-editable JSON file moved between
// devices, so nothing in it is trusted: every record is rebuilt field by field
// from narrowed values (no cast anywhere), and ONE invalid record refuses the
// WHOLE pack with its path — a partially applied import is the one outcome a
// person cannot reason about afterwards. Fields this app does not know are
// dropped on import; the pack format is the contract, not the file's extras.

import { CEFR_LEVELS, DEFAULT_ARC_LENGTH, ERROR_TYPES, TARGET_LANGUAGES } from "./types";
import type {
  Arc,
  ArcCanDo,
  ArcEpisode,
  ErrorTally,
  ErrorType,
  LearnedItem,
  LearnerProfile,
  LearningPack,
  ObjectiveMastery,
  Scenario,
  SessionRecord,
  SessionReview,
  SkillLevels,
  StoryState,
  TargetLanguage,
  TranscriptTurn,
} from "./types";
import {
  arrayOf,
  boolean,
  enumOf,
  field,
  integerIn,
  Invalid,
  isRecord,
  isoDate,
  nonEmptyString,
  number,
  optional,
  record,
  string,
  type Parser,
} from "./validate";

export { Invalid };

const language = enumOf(TARGET_LANGUAGES.map((l) => l.id));
const level = enumOf(CEFR_LEVELS);
const strings = arrayOf(string);
const optStr = optional(string);
const optStrings = optional(strings);

/** A validated pack with every optional list materialised. */
export interface ParsedPack {
  profile?: LearnerProfile;
  scenarios: Scenario[];
  items: LearnedItem[];
  sessions: SessionRecord[];
  objectives: ObjectiveMastery[];
  arcs: Arc[];
}

/** Drop undefined-valued keys so a round-trip does not grow `key: undefined`. */
function compact<T extends object>(o: T): T {
  for (const k in o) if (o[k] === undefined) Reflect.deleteProperty(o, k);
  return o;
}

// --- profile ------------------------------------------------------------------

const skillLevels: Parser<SkillLevels> = (v, path) => {
  const r = record(v, path);
  return {
    grammar: field(r, "grammar", number, path),
    vocab: field(r, "vocab", number, path),
    fluency: field(r, "fluency", number, path),
    interaction: field(r, "interaction", number, path),
  };
};

/** A map keyed by target language; unknown languages are refused. */
function byLanguage<T>(item: Parser<T>): Parser<Partial<Record<TargetLanguage, T>>> {
  return (v, path) => {
    const r = record(v, path);
    const out: Partial<Record<TargetLanguage, T>> = {};
    for (const [k, val] of Object.entries(r)) {
      const lang = language(k, `${path}.${k}`);
      out[lang] = item(val, `${path}.${k}`);
    }
    return out;
  };
}

const errorTally: Parser<ErrorTally> = (v, path) => {
  const r = record(v, path);
  return compact({
    count: field(r, "count", number, path),
    lastAt: field(r, "lastAt", isoDate, path),
    example: field(r, "example", optStr, path),
    correction: field(r, "correction", optStr, path),
  });
};

const errorLogForLanguage: Parser<Partial<Record<ErrorType, ErrorTally>>> = (v, path) => {
  const r = record(v, path);
  const out: Partial<Record<ErrorType, ErrorTally>> = {};
  for (const [k, val] of Object.entries(r)) {
    const type = enumOf(ERROR_TYPES)(k, `${path}.${k}`);
    out[type] = errorTally(val, `${path}.${k}`);
  }
  return out;
};

const historyEntry: Parser<{ at: string; cefr: string; overall: number }> = (v, path) => {
  const r = record(v, path);
  return {
    at: field(r, "at", isoDate, path),
    cefr: field(r, "cefr", string, path),
    overall: field(r, "overall", number, path),
  };
};

const parseProfile: Parser<LearnerProfile> = (v, path) => {
  const r = record(v, path);
  const prefs = field(r, "prefs", optional(record), path);
  return compact({
    language: field(r, "language", language, path),
    level: field(r, "level", level, path),
    focus: field(r, "focus", optStrings, path) ?? [],
    levels: field(r, "levels", optional(byLanguage(skillLevels)), path),
    levelHistory: field(r, "levelHistory", optional(byLanguage(arrayOf(historyEntry))), path),
    prefs: prefs
      ? compact({
          slowSpeech: field(prefs, "slowSpeech", optional(boolean), `${path}.prefs`),
          showLevelMeter: field(prefs, "showLevelMeter", optional(boolean), `${path}.prefs`),
        })
      : undefined,
    errorLog: field(r, "errorLog", optional(byLanguage(errorLogForLanguage)), path),
  });
};

// --- scenario -----------------------------------------------------------------

const parseScenario: Parser<Scenario> = (v, path) => {
  const r = record(v, path);
  const arc = field(r, "arc", optional(record), path);
  return compact({
    id: field(r, "id", nonEmptyString, path),
    title: field(r, "title", string, path),
    targetLanguage: field(r, "targetLanguage", language, path),
    level: field(r, "level", level, path),
    baseContext: field(r, "baseContext", optStr, path) ?? "",
    contentContext: field(r, "contentContext", optStr, path) ?? "",
    coachRole: field(r, "coachRole", optStr, path) ?? "",
    userRole: field(r, "userRole", optStr, path) ?? "",
    objectives: field(r, "objectives", strings, path),
    targetPhrases: field(r, "targetPhrases", optStrings, path) ?? [],
    progressNote: field(r, "progressNote", optStr, path),
    source: field(r, "source", optStr, path),
    arc: arc
      ? {
          arcId: field(arc, "arcId", nonEmptyString, `${path}.arc`),
          episode: field(arc, "episode", number, `${path}.arc`),
        }
      : undefined,
  });
};

// --- item ---------------------------------------------------------------------

const parseItem: Parser<LearnedItem> = (v, path) => {
  const r = record(v, path);
  const srs = field(r, "srs", optional(record), path);
  const use: Parser<{ sessionId: string; at: string }> = (u, p) => {
    const ur = record(u, p);
    return { sessionId: field(ur, "sessionId", nonEmptyString, p), at: field(ur, "at", isoDate, p) };
  };
  return compact({
    id: field(r, "id", nonEmptyString, path),
    language: field(r, "language", language, path),
    kind: field(r, "kind", enumOf(["word", "phrase", "grammar"] as const), path),
    text: field(r, "text", nonEmptyString, path),
    reading: field(r, "reading", optStr, path),
    meaning: field(r, "meaning", string, path),
    example: field(r, "example", optStr, path),
    sourceScenarioId: field(r, "sourceScenarioId", optStr, path),
    sourceSessionId: field(r, "sourceSessionId", optStr, path),
    firstSeenAt: field(r, "firstSeenAt", isoDate, path),
    cloze: field(r, "cloze", optStr, path),
    collocations: field(r, "collocations", optStrings, path),
    uses: field(r, "uses", optional(arrayOf(use)), path),
    tags: field(r, "tags", optStrings, path),
    srs: srs
      ? compact({
          due: field(srs, "due", optional(isoDate), `${path}.srs`),
          intervalDays: field(srs, "intervalDays", optional(number), `${path}.srs`),
          reps: field(srs, "reps", optional(number), `${path}.srs`),
          // The serialized ts-fsrs card is opaque to this app; its declared type is
          // Record<string, unknown>, which `record` yields without a cast.
          fsrs: field(srs, "fsrs", optional(record), `${path}.srs`),
        })
      : undefined,
  });
};

// --- session ------------------------------------------------------------------

const parseTurn: Parser<TranscriptTurn> = (v, path) => {
  const r = record(v, path);
  return { who: field(r, "who", enumOf(["user", "coach"] as const), path), text: field(r, "text", string, path) };
};

const parseStoredReview: Parser<SessionReview> = (v, path) => {
  const r = record(v, path);
  const subs = field(r, "subscores", optional(record), path);
  const verdict: Parser<{ objective: string; met: boolean }> = (o, p) => {
    const or = record(o, p);
    return { objective: field(or, "objective", string, p), met: field(or, "met", boolean, p) };
  };
  const error: Parser<NonNullable<SessionReview["errors"]>[number]> = (e, p) => {
    const er = record(e, p);
    return {
      type: field(er, "type", enumOf(ERROR_TYPES), p),
      example: field(er, "example", string, p),
      correction: field(er, "correction", string, p),
    };
  };
  return compact({
    cefr: field(r, "cefr", string, path),
    subscores: subs
      ? {
          grammar: field(subs, "grammar", number, `${path}.subscores`),
          vocab: field(subs, "vocab", number, `${path}.subscores`),
          fluency: field(subs, "fluency", number, `${path}.subscores`),
          interaction: field(subs, "interaction", number, `${path}.subscores`),
        }
      : undefined,
    reviewEn: field(r, "reviewEn", optStr, path) ?? "",
    reviewZh: field(r, "reviewZh", optStr, path) ?? "",
    progressNote: field(r, "progressNote", optStr, path) ?? "",
    wins: field(r, "wins", optStrings, path),
    fixes: field(r, "fixes", optStrings, path),
    objectivesMet: field(r, "objectivesMet", optional(arrayOf(verdict)), path),
    errors: field(r, "errors", optional(arrayOf(error)), path),
  });
};

const parseSession: Parser<SessionRecord> = (v, path) => {
  const r = record(v, path);
  const ledger = field(r, "finalize", optional(record), path);
  const aids = field(r, "aids", optional(record), path);
  const review = field(r, "review", optional(parseStoredReview), path);
  const count = integerIn(0, Number.MAX_SAFE_INTEGER); // a negative aid count would fake「無提示」
  return compact({
    id: field(r, "id", nonEmptyString, path),
    scenarioId: field(r, "scenarioId", nonEmptyString, path),
    startedAt: field(r, "startedAt", isoDate, path),
    transcript: field(r, "transcript", arrayOf(parseTurn), path),
    review,
    // Mutually exclusive on every write path; keep the stored record that way.
    judgeUnavailable: review ? undefined : field(r, "judgeUnavailable", optStr, path),
    kind: field(r, "kind", optional(enumOf(["micro"] as const)), path),
    focus: field(r, "focus", optStr, path),
    aids: aids
      ? {
          suggestions: field(aids, "suggestions", count, `${path}.aids`),
          translations: field(aids, "translations", count, `${path}.aids`),
        }
      : undefined,
    finalize: ledger
      ? compact({
          claimedAt: field(ledger, "claimedAt", optional(isoDate), `${path}.finalize`),
          itemsSaved: field(ledger, "itemsSaved", boolean, `${path}.finalize`),
          reviewApplied: field(ledger, "reviewApplied", boolean, `${path}.finalize`),
          arcAdvanced: field(ledger, "arcAdvanced", boolean, `${path}.finalize`),
        })
      : undefined,
  });
};

// --- objective ledger ---------------------------------------------------------

const parseObjective: Parser<ObjectiveMastery> = (v, path) => {
  const r = record(v, path);
  return compact({
    id: field(r, "id", nonEmptyString, path),
    scenarioId: field(r, "scenarioId", nonEmptyString, path),
    objective: field(r, "objective", string, path),
    attempts: field(r, "attempts", number, path),
    met: field(r, "met", number, path),
    lastMet: field(r, "lastMet", optional(boolean), path),
    selfRating: field(r, "selfRating", optional(enumOf(["no", "partly", "yes"] as const)), path),
    updatedAt: field(r, "updatedAt", isoDate, path),
  });
};

// --- arc ----------------------------------------------------------------------

const parseStoryState: Parser<StoryState> = (v, path) => {
  const r = record(v, path);
  const character: Parser<StoryState["characters"][number]> = (c, p) => {
    const cr = record(c, p);
    return { name: field(cr, "name", string, p), note: field(cr, "note", optStr, p) ?? "" };
  };
  return {
    characters: field(r, "characters", optional(arrayOf(character)), path) ?? [],
    events: field(r, "events", optStrings, path) ?? [],
    openThreads: field(r, "openThreads", optStrings, path) ?? [],
  };
};

const parseEpisode: Parser<ArcEpisode> = (v, path) => {
  const r = record(v, path);
  return compact({
    n: field(r, "n", integerIn(1, 99), path),
    scenarioId: field(r, "scenarioId", nonEmptyString, path),
    title: field(r, "title", optStr, path) ?? "",
    recap: field(r, "recap", optStr, path),
    canDoIds: field(r, "canDoIds", optStrings, path),
    completedAt: field(r, "completedAt", optional(isoDate), path),
  });
};

const parseCanDo: Parser<ArcCanDo> = (v, path) => {
  const r = record(v, path);
  return { id: field(r, "id", nonEmptyString, path), text: field(r, "text", string, path) };
};

const parseArc: Parser<Arc> = (v, path) => {
  const r = record(v, path);
  const planned = field(r, "plannedEpisodes", optional(number), path) ?? DEFAULT_ARC_LENGTH;
  const epoch = new Date(0).toISOString();
  return compact({
    id: field(r, "id", nonEmptyString, path),
    title: field(r, "title", string, path),
    targetLanguage: field(r, "targetLanguage", language, path),
    level: field(r, "level", level, path),
    premise: field(r, "premise", optStr, path) ?? "",
    episodes: field(r, "episodes", arrayOf(parseEpisode), path),
    // Re-clamped here: a data file must not drive unbounded episode generation.
    plannedEpisodes: Math.min(Math.max(Math.round(planned) || DEFAULT_ARC_LENGTH, 2), DEFAULT_ARC_LENGTH),
    storyState: field(r, "storyState", optional(parseStoryState), path) ?? { characters: [], events: [], openThreads: [] },
    canDos: field(r, "canDos", optional(arrayOf(parseCanDo)), path),
    outline: field(r, "outline", optStrings, path),
    createdAt: field(r, "createdAt", optional(isoDate), path) ?? epoch,
    updatedAt: field(r, "updatedAt", optional(isoDate), path) ?? epoch,
  });
};

// --- the pack -----------------------------------------------------------------

/**
 * Narrow parsed JSON into a pack, or throw `Invalid` naming what is wrong.
 * `knownScenarioIds` are the scenarios already in the store: an arc episode
 * must point at a scenario in the pack OR the store, otherwise the story could
 * never continue and the whole pack is refused.
 */
export function parsePack(input: unknown, knownScenarioIds: ReadonlySet<string> = new Set()): ParsedPack {
  if (!isRecord(input)) throw new Invalid("$", "這不是學習資料備份檔（不是 JSON 物件）");
  if (input.kind !== "learning-pack") throw new Invalid("$.kind", "這不是學習資料備份檔。");
  // The version literal is the entire forward-compatibility contract; reading a
  // newer pack with an older reader would silently drop whatever it added.
  if (input.version !== undefined && input.version !== 1)
    throw new Invalid("$.version", `這個備份是版本 ${String(input.version)}，這個版本的 app 看不懂 — 請先更新。`);

  const list = <T>(key: keyof LearningPack, item: Parser<T>) => field(input, key, optional(arrayOf(item)), "$") ?? [];
  const parsed: ParsedPack = {
    profile: field(input, "profile", optional(parseProfile), "$"),
    scenarios: list("scenarios", parseScenario),
    items: list("items", parseItem),
    sessions: list("sessions", parseSession),
    objectives: list("objectives", parseObjective),
    arcs: list("arcs", parseArc),
  };

  const scenarioIds = new Set([...knownScenarioIds, ...parsed.scenarios.map((s) => s.id)]);
  parsed.arcs.forEach((arc, i) => {
    arc.episodes.forEach((ep, j) => {
      if (!scenarioIds.has(ep.scenarioId))
        throw new Invalid(`$.arcs[${i}].episodes[${j}].scenarioId`, `故事線「${arc.title}」第 ${ep.n} 集指向不存在的情境`);
    });
  });
  return parsed;
}

/** What an import would do, so the user can be told before anything is written. */
export interface ImportSummary {
  added: number;
  overwritten: number;
  replacesProfile: boolean; // the pack carries a profile, which replaces the local one wholesale
}

export function summariseImport(
  pack: ParsedPack,
  existing: {
    scenarios: ReadonlySet<string>;
    items: ReadonlySet<string>;
    sessions: ReadonlySet<string>;
    objectives: ReadonlySet<string>;
    arcs: ReadonlySet<string>;
  },
): ImportSummary {
  let added = 0;
  let overwritten = 0;
  const count = (ids: string[], known: ReadonlySet<string>) => {
    for (const id of ids) if (known.has(id)) overwritten++; else added++;
  };
  count(pack.scenarios.map((s) => s.id), existing.scenarios);
  count(pack.items.map((s) => s.id), existing.items);
  count(pack.sessions.map((s) => s.id), existing.sessions);
  count(pack.objectives.map((s) => s.id), existing.objectives);
  count(pack.arcs.map((s) => s.id), existing.arcs);
  return { added, overwritten, replacesProfile: !!pack.profile };
}
