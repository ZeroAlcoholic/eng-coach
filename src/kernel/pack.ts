// Portable interop: export the whole local-first dataset as a LearningPack JSON
// (drop it on the NAS to move between devices, or hand it to another tool), and
// export learned items as Anki/Quizlet-friendly CSV — the bridge to other
// practice systems. Import merges a pack back into the shared store.

import type { LearnedItem, LearningPack, Scenario } from "./types";
import {
  getProfile,
  listItems,
  listScenarios,
  listSessions,
  putItems,
  putProfile,
  putScenario,
  putSession,
} from "./db";

export async function buildPack(): Promise<LearningPack> {
  const [profile, scenarios, items, sessions] = await Promise.all([
    getProfile(),
    listScenarios(),
    listItems(),
    listSessions(),
  ]);
  return {
    version: 1,
    kind: "learning-pack",
    exportedAt: new Date().toISOString(),
    profile,
    scenarios,
    items,
    sessions,
  };
}

/** A single-scenario pack — the lightweight "progress file". */
export async function buildScenarioPack(scenario: Scenario): Promise<LearningPack> {
  const all = await listItems();
  return {
    version: 1,
    kind: "learning-pack",
    exportedAt: new Date().toISOString(),
    scenarios: [scenario],
    items: all.filter((i) => i.sourceScenarioId === scenario.id),
  };
}

export async function importPack(pack: LearningPack): Promise<void> {
  if (pack.kind !== "learning-pack") throw new Error("not a learning pack");
  if (pack.profile) await putProfile(pack.profile);
  for (const sc of pack.scenarios ?? []) await putScenario(sc);
  if (pack.items?.length) await putItems(pack.items);
  for (const s of pack.sessions ?? []) await putSession(s);
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
