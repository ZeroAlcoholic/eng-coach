// Chunk-use tracking: did the learner PRODUCE an item they were taught earlier?
//
// Zero API: an item counts as used in a session when its text appears inside a
// learner turn of a session that is not the one it was extracted from. Matching
// is case-insensitive and whole-string (no stemming — a wrong match would claim
// a use that never happened, and Japanese has no word boundaries to lean on),
// so this UNDER-counts. That is the honest direction for a progress readout.

import type { LearnedItem, TargetLanguage, TranscriptTurn } from "../../kernel/types";

const MIN_ITEM_CHARS = 2; // one-character items ("a", "を") match everything

/** Pure: which of `items` were produced in these learner turns. */
export function itemsUsedIn(items: LearnedItem[], transcript: TranscriptTurn[], language: TargetLanguage): LearnedItem[] {
  const said = transcript
    .filter((t) => t.who === "user")
    .map((t) => t.text.toLocaleLowerCase())
    .join("\n");
  if (!said.trim()) return [];
  return items.filter((it) => {
    if (it.language !== language) return false;
    const needle = it.text.trim().toLocaleLowerCase();
    return needle.length >= MIN_ITEM_CHARS && said.includes(needle);
  });
}

/** Append a use record to each matched item, skipping the item's own source
 *  session (being taught is not using) and sessions already recorded. */
export function withUse(item: LearnedItem, sessionId: string, at: string): LearnedItem | null {
  if (item.sourceSessionId === sessionId) return null;
  if (item.uses?.some((u) => u.sessionId === sessionId)) return null;
  return { ...item, uses: [...(item.uses ?? []), { sessionId, at }] };
}

/** The store slice this needs — the finalize pipeline passes its deps. */
export async function recordItemUses(
  store: { listItems: () => Promise<LearnedItem[]>; putItems: (items: LearnedItem[]) => Promise<void> },
  sessionId: string,
  transcript: TranscriptTurn[],
  language: TargetLanguage,
  at: string,
): Promise<number> {
  const used = itemsUsedIn(await store.listItems(), transcript, language)
    .map((it) => withUse(it, sessionId, at))
    .filter((it): it is LearnedItem => it !== null);
  if (used.length) await store.putItems(used);
  return used.length;
}
