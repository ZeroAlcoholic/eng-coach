// The shared local-first store. One IndexedDB database for the whole folder of
// tools: scenarios, sessions, learned items, and a key/value slot for the
// profile. Hand-rolled (no dependency) and versioned — bump DB_VERSION and add
// to onupgradeneeded when the schema grows.

import type { DraftSession, LearnedItem, LearnerProfile, Scenario, SessionRecord } from "./types";
import { DEFAULT_PROFILE } from "./types";

const DB_NAME = "learn-kernel";
// v2: sessions.startedAt index, so "newest first" reads don't getAll() the store.
const DB_VERSION = 2;

type StoreName = "scenarios" | "sessions" | "items" | "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Idempotent per store/index so the same code handles fresh create AND
      // every upgrade path (a v1 device must gain the startedAt index).
      const db = req.result;
      const tx = req.transaction!; // always set inside onupgradeneeded
      const store = (name: string, options?: IDBObjectStoreParameters) =>
        db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, options);

      store("scenarios", { keyPath: "id" });
      const sessions = store("sessions", { keyPath: "id" });
      if (!sessions.indexNames.contains("scenarioId")) sessions.createIndex("scenarioId", "scenarioId");
      if (!sessions.indexNames.contains("startedAt")) sessions.createIndex("startedAt", "startedAt");
      const items = store("items", { keyPath: "id" });
      if (!items.indexNames.contains("language")) items.createIndex("language", "language");
      if (!items.indexNames.contains("sourceScenarioId")) items.createIndex("sourceScenarioId", "sourceScenarioId");
      store("kv");
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
/** Full records incl. transcripts — only for whole-dataset jobs (pack export). */
export const listSessions = () => run<SessionRecord[]>("sessions", "readonly", (s) => s.getAll());
/** Cheap count — no record deserialization. */
export const countSessions = () => run<number>("sessions", "readonly", (s) => s.count());

/**
 * Walk sessions NEWEST-FIRST via the startedAt index; return false from the
 * callback to stop. This is the scalable read path: a year of transcripts is
 * megabytes, and most screens only need the first few records.
 */
export async function scanSessionsDesc(
  cb: (rec: SessionRecord) => boolean | void,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const index = db.transaction("sessions", "readonly").objectStore("sessions").index("startedAt");
    const req = index.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      if (cb(cursor.value as SessionRecord) === false) return resolve();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// --- learned items (the interop unit) ---
export const listItems = () => run<LearnedItem[]>("items", "readonly", (s) => s.getAll());
export const deleteItem = (id: string) =>
  run<undefined>("items", "readwrite", (s) => s.delete(id));
export async function putItems(items: LearnedItem[]): Promise<void> {
  if (!items.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// --- draft session (singleton in kv) — crash-recovery for a live session ---
export const getDraft = () =>
  run<DraftSession | undefined>("kv", "readonly", (s) => s.get("draft-session"));
export const putDraft = (d: DraftSession) =>
  run<IDBValidKey>("kv", "readwrite", (s) => s.put(d, "draft-session"));
export const clearDraft = () =>
  run<undefined>("kv", "readwrite", (s) => s.delete("draft-session"));

// --- profile (singleton in kv) ---
export async function getProfile(): Promise<LearnerProfile> {
  const p = await run<LearnerProfile | undefined>("kv", "readonly", (s) => s.get("profile"));
  return p ?? DEFAULT_PROFILE;
}
export const putProfile = (p: LearnerProfile) =>
  run<IDBValidKey>("kv", "readwrite", (s) => s.put(p, "profile"));
