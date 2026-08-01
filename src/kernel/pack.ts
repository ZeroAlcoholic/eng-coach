// Portable interop: export the whole local-first dataset as a LearningPack JSON
// (drop it on the NAS to move between devices, or hand it to another tool), and
// export learned items as Anki/Quizlet-friendly CSV — the bridge to other
// practice systems. Import merges a pack back into the shared store.

import type { LearnedItem, LearningPack, Scenario } from "./types";
import {
  getProfile,
  listItems,
  listObjectives,
  listObjectivesFor,
  listScenarios,
  listSessions,
  putItems,
  putObjectives,
  putProfile,
  putScenario,
  putSession,
} from "./db";

export async function buildPack(): Promise<LearningPack> {
  const [profile, scenarios, items, sessions, objectives] = await Promise.all([
    getProfile(),
    listScenarios(),
    listItems(),
    listSessions(),
    listObjectives(),
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
  };
}

/** A single-scenario pack — the lightweight "progress file". */
export async function buildScenarioPack(scenario: Scenario): Promise<LearningPack> {
  const [all, objectives] = await Promise.all([listItems(), listObjectivesFor(scenario.id)]);
  return {
    version: 1,
    kind: "learning-pack",
    exportedAt: new Date().toISOString(),
    scenarios: [scenario],
    items: all.filter((i) => i.sourceScenarioId === scenario.id),
    objectives,
  };
}

export async function importPack(pack: LearningPack): Promise<void> {
  if (pack.kind !== "learning-pack") throw new Error("not a learning pack");
  if (pack.profile) await putProfile(pack.profile);
  for (const sc of pack.scenarios ?? []) await putScenario(sc);
  if (pack.items?.length) await putItems(pack.items);
  for (const s of pack.sessions ?? []) await putSession(s);
  if (pack.objectives?.length) await putObjectives(pack.objectives);
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
