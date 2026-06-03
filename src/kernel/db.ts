// The shared local-first store. One IndexedDB database for the whole folder of
// tools: scenarios, sessions, learned items, and a key/value slot for the
// profile. Hand-rolled (no dependency) and versioned — bump DB_VERSION and add
// to onupgradeneeded when the schema grows.

import type { LearnedItem, LearnerProfile, Scenario, SessionRecord } from "./types";
import { DEFAULT_PROFILE } from "./types";

const DB_NAME = "learn-kernel";
const DB_VERSION = 1;

type StoreName = "scenarios" | "sessions" | "items" | "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("scenarios")) {
        db.createObjectStore("scenarios", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" }).createIndex(
          "scenarioId",
          "scenarioId",
        );
      }
      if (!db.objectStoreNames.contains("items")) {
        const items = db.createObjectStore("items", { keyPath: "id" });
        items.createIndex("language", "language");
        items.createIndex("sourceScenarioId", "sourceScenarioId");
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one request in a transaction and resolve its result. */
async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

// --- scenarios ---
export const listScenarios = () => run<Scenario[]>("scenarios", "readonly", (s) => s.getAll());
export const putScenario = (sc: Scenario) =>
  run<IDBValidKey>("scenarios", "readwrite", (s) => s.put(sc));
export const deleteScenario = (id: string) =>
  run<undefined>("scenarios", "readwrite", (s) => s.delete(id));

// --- sessions ---
export const putSession = (rec: SessionRecord) =>
  run<IDBValidKey>("sessions", "readwrite", (s) => s.put(rec));
export const listSessionsFor = (scenarioId: string) =>
  run<SessionRecord[]>("sessions", "readonly", (s) =>
    s.index("scenarioId").getAll(IDBKeyRange.only(scenarioId)),
  );
export const listSessions = () => run<SessionRecord[]>("sessions", "readonly", (s) => s.getAll());

// --- learned items (the interop unit) ---
export const listItems = () => run<LearnedItem[]>("items", "readonly", (s) => s.getAll());
export async function putItems(items: LearnedItem[]): Promise<void> {
  for (const item of items) await run("items", "readwrite", (s) => s.put(item));
}

// --- profile (singleton in kv) ---
export async function getProfile(): Promise<LearnerProfile> {
  const p = await run<LearnerProfile | undefined>("kv", "readonly", (s) => s.get("profile"));
  return p ?? DEFAULT_PROFILE;
}
export const putProfile = (p: LearnerProfile) =>
  run<IDBValidKey>("kv", "readwrite", (s) => s.put(p, "profile"));
