// The shared local-first store. One IndexedDB database for the whole folder of
// tools: scenarios, sessions, learned items, and a key/value slot for the
// profile. Hand-rolled (no dependency) and versioned — bump DB_VERSION and add
// to onupgradeneeded when the schema grows.

import type {
  Arc,
  DraftSession,
  LearnedItem,
  LearnerProfile,
  ObjectiveMastery,
  Scenario,
  SessionRecord,
} from "./types";
import { DEFAULT_PROFILE } from "./types";

const DB_NAME = "learn-kernel";
// v2: sessions.startedAt index, so "newest first" reads don't getAll() the store.
// v3: objectives store (C1 per-objective mastery ledger), indexed by scenarioId.
// v4: arcs store (S1 story arcs), indexed by targetLanguage.
const DB_VERSION = 4;

type StoreName = "scenarios" | "sessions" | "items" | "kv" | "objectives" | "arcs";

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
      const objectives = store("objectives", { keyPath: "id" });
      if (!objectives.indexNames.contains("scenarioId")) objectives.createIndex("scenarioId", "scenarioId");
      const arcs = store("arcs", { keyPath: "id" });
      if (!arcs.indexNames.contains("targetLanguage")) arcs.createIndex("targetLanguage", "targetLanguage");
    };
    // If THIS open is held up by another tab still holding an older-version
    // connection, fail loud instead of hanging the promise forever (every read
    // path awaits openDB). The other tab's onversionchange below normally clears
    // the block immediately; onblocked only fires if it can't.
    req.onblocked = () =>
      reject(new Error("資料庫升級被另一個分頁卡住 — 請關閉其他開著的分頁後重試。"));
    req.onsuccess = () => {
      const db = req.result;
      // A future version (a new tab loading a newer build) must be able to
      // upgrade: drop this connection so its open doesn't block. Each operation
      // reopens lazily, so closing here is safe.
      db.onversionchange = () => db.close();
      resolve(db);
    };
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
export const getScenario = (id: string) =>
  run<Scenario | undefined>("scenarios", "readonly", (s) => s.get(id));
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

// --- objectives (C1 mastery ledger) ---
export const objectiveKey = (scenarioId: string, objective: string) => `${scenarioId}::${objective}`;
export const getObjective = (id: string) =>
  run<ObjectiveMastery | undefined>("objectives", "readonly", (s) => s.get(id));
export const putObjective = (rec: ObjectiveMastery) =>
  run<IDBValidKey>("objectives", "readwrite", (s) => s.put(rec));
/** Whole ledger — for pack export. */
export const listObjectives = () =>
  run<ObjectiveMastery[]>("objectives", "readonly", (s) => s.getAll());
export async function putObjectives(recs: ObjectiveMastery[]): Promise<void> {
  if (!recs.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("objectives", "readwrite");
    const store = tx.objectStore("objectives");
    for (const rec of recs) store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/** All mastery records for one scenario — via the scenarioId index. */
export async function listObjectivesFor(scenarioId: string): Promise<ObjectiveMastery[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const index = db.transaction("objectives", "readonly").objectStore("objectives").index("scenarioId");
    const req = index.getAll(scenarioId);
    req.onsuccess = () => resolve(req.result as ObjectiveMastery[]);
    req.onerror = () => reject(req.error);
  });
}

// --- arcs (S1 story arcs) ---
export const getArc = (id: string) => run<Arc | undefined>("arcs", "readonly", (s) => s.get(id));
export const listArcs = () => run<Arc[]>("arcs", "readonly", (s) => s.getAll());
export const putArc = (arc: Arc) => run<IDBValidKey>("arcs", "readwrite", (s) => s.put(arc));
export const deleteArc = (id: string) => run<undefined>("arcs", "readwrite", (s) => s.delete(id));
export async function putArcs(arcs: Arc[]): Promise<void> {
  if (!arcs.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("arcs", "readwrite");
    const store = tx.objectStore("arcs");
    for (const arc of arcs) store.put(arc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Read-modify-write an arc inside ONE transaction.
 *
 * `getArc` then `putArc` is two transactions, so a second tab (or a second call in
 * this one) can interleave and silently drop the earlier edit — and this app is
 * plainly multi-tab. `mutate` returning undefined leaves the record untouched.
 * Resolves to the stored arc, or undefined when there was nothing to change.
 */
export async function updateArc(
  id: string,
  mutate: (arc: Arc) => Arc | undefined,
): Promise<Arc | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("arcs", "readwrite");
    const store = tx.objectStore("arcs");
    const read = store.get(id);
    let result: Arc | undefined;
    read.onsuccess = () => {
      const current = read.result as Arc | undefined;
      if (!current) return; // nothing to update; tx completes as a no-op
      const next = mutate(current);
      if (!next) return;
      result = next;
      store.put(next);
    };
    read.onerror = () => reject(read.error);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Materialising an episode means writing TWO records that are meaningless apart:
 * the arc (now listing episode N) and the Scenario episode N points at. Do it in
 * ONE transaction so a mid-write failure can never leave an episode referencing a
 * scenario that doesn't exist — the arc simply stays one episode shorter and the
 * generation is retried (ROADMAP S1 guard: best-effort, retryable).
 */
export class ArcRaceError extends Error {
  constructor() {
    super("這條故事線在另一個分頁被更新了 — 請重新整理後再試。");
    this.name = "ArcRaceError";
  }
}

export async function putArcWithScenario(
  arc: Arc,
  scenario: Scenario,
  // Episode count the caller based its work on. Checked INSIDE the transaction so
  // a second tab that materialised an episode meanwhile can't be silently
  // overwritten (which would orphan its scenario and break the one-pending rule).
  expectedEpisodes?: number,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["arcs", "scenarios"], "readwrite");
    const arcs = tx.objectStore("arcs");
    const read = arcs.get(arc.id);
    read.onsuccess = () => {
      const stored = read.result as Arc | undefined;
      if (expectedEpisodes !== undefined && (stored?.episodes.length ?? 0) !== expectedEpisodes) {
        tx.abort();
        reject(new ArcRaceError());
        return;
      }
      tx.objectStore("scenarios").put(scenario);
      arcs.put(arc);
    };
    read.onerror = () => reject(read.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // A deliberate abort above already rejected; don't reject twice.
    tx.onabort = () => reject(tx.error ?? new ArcRaceError());
  });
}

/** Newest-first sessions for one scenario, via the scenarioId index. */
export async function listSessionsFor(scenarioId: string): Promise<SessionRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const index = db.transaction("sessions", "readonly").objectStore("sessions").index("scenarioId");
    const req = index.getAll(scenarioId);
    req.onsuccess = () =>
      resolve(
        (req.result as SessionRecord[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      );
    req.onerror = () => reject(req.error);
  });
}

// --- profile (singleton in kv) ---
export async function getProfile(): Promise<LearnerProfile> {
  const p = await run<LearnerProfile | undefined>("kv", "readonly", (s) => s.get("profile"));
  return p ?? DEFAULT_PROFILE;
}
export const putProfile = (p: LearnerProfile) =>
  run<IDBValidKey>("kv", "readwrite", (s) => s.put(p, "profile"));
