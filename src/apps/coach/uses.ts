// Chunk-use tracking: did the learner PRODUCE an item they were taught earlier?
//
// Zero API: an item counts as used in a session when its text appears inside a
// learner turn of a session that is not the one it was extracted from. Only
// the learner's OWN production counts — a turn that echoes the coach, follows a
// help request or contains Chinese is skipped (annotate.ts), because "the
// coach said it and I said it back" is not "I reached for it". Matching is
// case-insensitive and whole-string (no stemming — a wrong match would claim a
// use that never happened, and Japanese has no word boundaries to lean on), so
// this UNDER-counts. That is the honest direction for a progress readout.
//
// A grammar item with a `frame` ("I'd rather ___ than ___") is matched by its
// anchors — the fixed words between the slots — found in order inside ONE
// learner turn, so a pattern filled with different words still counts.

import type { LearnedItem, TargetLanguage, TranscriptTurn } from "../../kernel/types";
import { isOwnProduction } from "./annotate";

const MIN_ITEM_CHARS = 2; // one-character items ("a", "を") match everything
const SLOT = "___";
const MIN_ANCHOR_CHARS = 2;

/** The fixed parts of a frame, in order. Empty when the frame has no usable
 *  anchor, so a frame that is all slots can never match. Plain substrings, not
 *  a regex: a frame is model output and must carry no pattern meaning. */
export function frameAnchors(frame: string): string[] {
  return frame
    .split(SLOT)
    .map((part) => part.trim().toLocaleLowerCase())
    .filter((part) => part.length >= MIN_ANCHOR_CHARS);
}

/** Do the anchors occur in `text`, in order, without overlapping? */
export function matchesFrame(text: string, anchors: readonly string[]): boolean {
  if (!anchors.length) return false;
  let from = 0;
  for (const anchor of anchors) {
    const at = text.indexOf(anchor, from);
    if (at < 0) return false;
    from = at + anchor.length;
  }
  return true;
}

/** Pure: which of `items` were produced in these learner turns. */
export function itemsUsedIn(items: LearnedItem[], transcript: TranscriptTurn[], language: TargetLanguage): LearnedItem[] {
  const turns = transcript.filter(isOwnProduction).map((t) => t.text.toLocaleLowerCase());
  const said = turns.join("\n");
  if (!said.trim()) return [];
  return items.filter((it) => {
    if (it.language !== language) return false;
    if (it.frame) {
      const anchors = frameAnchors(it.frame);
      return turns.some((turn) => matchesFrame(turn, anchors));
    }
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
