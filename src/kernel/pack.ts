// Portable interop: export the whole local-first dataset as a LearningPack JSON
// (drop it on the NAS to move between devices, or hand it to another tool), and
// export learned items as Anki/Quizlet-friendly CSV — the bridge to other
// practice systems. Import validates a pack in full (packSchema.ts) and writes
// it in one transaction.

import type { Arc, LearnedItem, LearningPack, Scenario } from "./types";
import { DEFAULT_PROFILE } from "./types";
import {
  getArc,
  getProfile,
  getScenario,
  importAll,
  listArcs,
  listItems,
  listObjectives,
  listObjectivesFor,
  listScenarios,
  listSessions,
} from "./db";
import { parsePack, summariseImport, type ImportSummary, type ParsedPack } from "./packSchema";

export { Invalid as PackInvalid } from "./packSchema";

export async function buildPack(): Promise<LearningPack> {
  const [profile, scenarios, items, sessions, objectives, arcs] = await Promise.all([
    getProfile(),
    listScenarios(),
    listItems(),
    listSessions(),
    listObjectives(),
    listArcs(),
  ]);
  return {
    version: 1,
    kind: "learning-pack",
    exportedAt: new Date().toISOString(),
    profile,
    scenarios,
    items,
    sessions,
    objectives,
    arcs,
  };
}

/** A single-scenario pack — the lightweight "progress file". An episode carries
 *  its whole arc AND every scenario the arc points at, otherwise the restored arc
 *  references episodes that don't exist and the story can never continue. */
export async function buildScenarioPack(scenario: Scenario): Promise<LearningPack> {
  const arcId = scenario.arc?.arcId;
  const [all, objectives, arcObjectives, arc] = await Promise.all([
    listItems(),
    listObjectivesFor(scenario.id),
    // S3 keys an arc's can-do mastery on the ARC id, so exporting only the
    // scenario's rows would drop the accumulated attempts — and the learner's
    // self-ratings, which cannot be reconstructed from transcripts.
    arcId ? listObjectivesFor(arcId) : Promise.resolve([]),
    arcId ? getArc(arcId) : Promise.resolve(undefined),
  ]);
  const episodeScenarios = arc
    ? (await Promise.all(arc.episodes.map((e) => getScenario(e.scenarioId)))).filter(
        (s): s is Scenario => !!s,
      )
    : [];
  const scenarios = [scenario, ...episodeScenarios.filter((s) => s.id !== scenario.id)];
  return {
    version: 1,
    kind: "learning-pack",
    exportedAt: new Date().toISOString(),
    scenarios,
    items: all.filter((i) => scenarios.some((s) => s.id === i.sourceScenarioId)),
    objectives: [...objectives, ...arcObjectives],
    ...(arc ? { arcs: [arc] } : {}),
  };
}

/**
 * Import, in two steps so the user is told what will happen BEFORE anything is
 * written: `planImport` validates the whole file (one bad record refuses it all,
 * with the path) and counts adds vs overwrites; `commitImport` writes everything
 * in ONE transaction. Nothing is written by a plan.
 */
export interface ImportPlan {
  pack: ParsedPack;
  summary: ImportSummary;
}

export async function planImport(input: unknown): Promise<ImportPlan> {
  const [scenarios, items, sessions, arcs] = await Promise.all([listScenarios(), listItems(), listSessions(), listArcs()]);
  const ids = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id));
  const known = { scenarios: ids(scenarios), items: ids(items), sessions: ids(sessions), arcs: ids(arcs) };
  const pack = parsePack(input, known.scenarios);
  return { pack, summary: summariseImport(pack, known) };
}

export async function commitImport(plan: ImportPlan): Promise<void> {
  const { pack } = plan;
  const arcs = await Promise.all(pack.arcs.map(keepFurtherAlong));
  await importAll({
    // Merge over the defaults: a profile missing optional maps would otherwise
    // break level maths app-wide (getProfile only falls back when the row is ABSENT).
    profile: pack.profile ? { ...DEFAULT_PROFILE, ...pack.profile } : undefined,
    scenarios: pack.scenarios,
    items: pack.items,
    sessions: pack.sessions,
    objectives: pack.objectives,
    arcs,
  });
}

/**
 * Merge policy for an arc that already exists locally (demo arcs have stable
 * ids): a stale export must not overwrite a further-along story and orphan the
 * episodes it drops. Keep whichever side has more episodes; tie-break on
 * updatedAt. Validation (every episode resolvable) already happened in parsePack.
 */
async function keepFurtherAlong(incoming: Arc): Promise<Arc> {
  const existing = await getArc(incoming.id);
  if (!existing) return incoming;
  const keepExisting =
    existing.episodes.length > incoming.episodes.length ||
    (existing.episodes.length === incoming.episodes.length && (existing.updatedAt ?? "") > (incoming.updatedAt ?? ""));
  return keepExisting ? existing : incoming;
}

// --- CSV (Anki/Quizlet): one row per item, header first ---
const CSV_COLUMNS: (keyof LearnedItem)[] = ["text", "reading", "meaning", "example", "kind", "language"];

export function itemsToCsv(items: LearnedItem[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    [...CSV_COLUMNS, "tags"].join(","),
    ...items.map((it) =>
      [...CSV_COLUMNS.map((c) => esc(it[c])), esc((it.tags ?? []).join(" "))].join(","),
    ),
  ];
  return rows.join("\n");
}

// --- backup ----------------------------------------------------------------
// One-tap backup of the whole dataset. On phones the Web Share API hands the
// file straight to "Save to Files"/NAS/cloud; everywhere else (desktop) we fall
// back to a plain download. User-initiated only — there is deliberately no
// "you haven't backed up in N days" nag (irregular use is a first-class
// assumption). Returns the path taken so callers can message it.
export type BackupResult = "shared" | "cancelled" | "downloaded";

export async function backupPack(): Promise<BackupResult> {
  const json = JSON.stringify(await buildPack(), null, 2);
  const file = new File([json], "learning-pack.json", { type: "application/json" });
  // canShare({files}) is the only honest capability check — bare navigator.share
  // exists on some desktops that can't actually attach a file.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "學習資料備份" });
      return "shared";
    } catch (err) {
      // AbortError = the user dismissed the share sheet on purpose. That is NOT
      // a failure, and we must NOT silently download behind their back.
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Anything else (notably NotAllowedError when the transient user
      // activation lapsed during the async buildPack reads, or share is blocked)
      // is NOT a deliberate cancel — the user asked to back up, so honour that
      // intent by falling back to a plain download rather than reporting failure.
    }
  }
  downloadFile("learning-pack.json", json, "application/json");
  return "downloaded";
}

// --- file download / read helpers ---
export function downloadFile(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}
