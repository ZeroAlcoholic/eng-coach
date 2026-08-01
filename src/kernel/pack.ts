// Portable interop: export the whole local-first dataset as a LearningPack JSON
// (drop it on the NAS to move between devices, or hand it to another tool), and
// export learned items as Anki/Quizlet-friendly CSV — the bridge to other
// practice systems. Import merges a pack back into the shared store.

import type { Arc, LearnedItem, LearningPack, Scenario } from "./types";
import { DEFAULT_ARC_LENGTH, DEFAULT_PROFILE } from "./types";
import {
  getArc,
  getProfile,
  getScenario,
  listArcs,
  listItems,
  listObjectives,
  listObjectivesFor,
  listScenarios,
  listSessions,
  putArcs,
  putItems,
  putObjectives,
  putProfile,
  putScenario,
  putSession,
} from "./db";

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
 * Merge a pack back into the store.
 *
 * A pack is a hand-editable JSON file moved between devices, so NOTHING in it is
 * trusted: the caller casts parsed JSON straight to `LearningPack`. Records without
 * an `id` are skipped rather than allowed to abort a whole store's transaction
 * midway, and arcs are reconciled (below) instead of blindly overwritten.
 */
export async function importPack(pack: LearningPack): Promise<void> {
  if (pack.kind !== "learning-pack") throw new Error("這不是學習資料備份檔。");
  // The version literal is the entire forward-compatibility contract; reading a
  // newer pack with an older reader would silently drop whatever it added.
  if (pack.version !== undefined && pack.version !== 1)
    throw new Error(`這個備份是版本 ${String(pack.version)}，這個版本的 app 看不懂 — 請先更新。`);
  const withId = <T extends { id?: unknown }>(xs: T[] | undefined) =>
    (Array.isArray(xs) ? xs : []).filter((x) => typeof x?.id === "string" && x.id);

  // Merge over the defaults: a profile missing `language`/`level` would otherwise
  // break level maths and new-scenario defaults app-wide (getProfile only falls
  // back when the row is ABSENT, not when it is malformed).
  if (pack.profile) await putProfile({ ...DEFAULT_PROFILE, ...pack.profile });
  for (const sc of withId(pack.scenarios)) await putScenario(sc);
  const items = withId(pack.items);
  if (items.length) await putItems(items);
  for (const s of withId(pack.sessions)) await putSession(s);
  const objectives = withId(pack.objectives);
  if (objectives.length) await putObjectives(objectives);
  const arcs = withId(pack.arcs);
  if (arcs.length) await putArcs(await Promise.all(arcs.map((a) => reconcileArc(a, pack))));
}

/**
 * Make an incoming arc safe to store.
 *
 * Two failure modes this closes, both silent and both permanent:
 *  1. An arc whose episodes point at scenarios that are in neither the pack nor the
 *     store — 「下一集」 can never resolve them, so the story is dead. Episode order
 *     is load-bearing, so we TRUNCATE at the first gap rather than filtering holes.
 *  2. A stale arc overwriting a further-along one under the same (stable, for demo
 *     arcs) id, orphaning the episodes it drops. Keep whichever side has more
 *     episodes; tie-break on updatedAt.
 * Also re-clamps plannedEpisodes, which otherwise lets a data file drive unbounded
 * episode generation.
 */
async function reconcileArc(arc: Arc, pack: LearningPack): Promise<Arc> {
  const inPack = new Set((pack.scenarios ?? []).map((s) => s?.id));
  const episodes: Arc["episodes"] = [];
  for (const ep of Array.isArray(arc.episodes) ? arc.episodes : []) {
    const resolvable = inPack.has(ep?.scenarioId) || !!(await getScenario(ep?.scenarioId));
    if (!resolvable) break;
    episodes.push(ep);
  }
  const planned = Math.min(Math.max(Math.round(arc.plannedEpisodes) || DEFAULT_ARC_LENGTH, 2), DEFAULT_ARC_LENGTH);
  const incoming: Arc = { ...arc, episodes, plannedEpisodes: planned };
  const existing = await getArc(arc.id);
  if (!existing) return incoming;
  const keepExisting =
    existing.episodes.length > incoming.episodes.length ||
    (existing.episodes.length === incoming.episodes.length &&
      (existing.updatedAt ?? "") > (incoming.updatedAt ?? ""));
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
