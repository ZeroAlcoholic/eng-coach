// Storage durability — ask the browser to make IndexedDB persistent so a mobile
// OS can't silently evict the user's data (iOS ITP reaps non-persistent
// storage after ~7 idle days; Android may clear under storage pressure). Every
// call here is best-effort: unsupported engines report "unsupported" and the
// app still works — the data just isn't protected from eviction, which is why
// the manual backup (A2) exists alongside this.

export type PersistState = "persisted" | "best-effort" | "unsupported";

/**
 * Ask once for persistent storage; returns the resulting state. Idempotent and
 * safe to call on every load — the browser prompts at most once and most
 * engines grant it silently from engagement signals (installed PWA, bookmarks,
 * repeat visits). Already-persisted is detected first so we never re-request.
 */
export async function ensurePersisted(): Promise<PersistState> {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return "unsupported";
  try {
    if (await navigator.storage.persisted()) return "persisted";
    return (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

/** Current state WITHOUT requesting — for displaying status in settings. */
export async function persistedState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}
