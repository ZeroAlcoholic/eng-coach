// W7 — FSRS spaced review over LearnedItem, wrapping ts-fsrs (zero-dep).
// Pure helpers, side-effect-free: rating returns a NEW item; callers persist.
//
// Card state rides on item.srs: due/intervalDays/reps are the stable interop
// surface other tools read; srs.fsrs carries the full serialized ts-fsrs card
// (dates as ISO strings) so scheduling resumes exactly. No srs → a NEW card,
// due immediately.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";

import type { LearnedItem, TargetLanguage } from "../../kernel/types";

const scheduler = fsrs(); // default parameters — no optimizer below ~1000 reviews

export type ReviewRating = "again" | "hard" | "good" | "easy";

const RATING: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function isDue(item: LearnedItem, now: Date): boolean {
  const due = item.srs?.due;
  return due ? new Date(due) <= now : true;
}

export function countDue(items: LearnedItem[], lang: TargetLanguage, now: Date): number {
  return items.filter((i) => i.language === lang && isDue(i, now)).length;
}

/** Review queue: previously-seen cards first (most overdue first), then new
 *  items (oldest first), capped so a backlog never becomes a wall. */
export function dueQueue(
  items: LearnedItem[],
  lang: TargetLanguage,
  now: Date,
  cap: number,
): LearnedItem[] {
  const due = items.filter((i) => i.language === lang && isDue(i, now));
  const seen = due
    .filter((i) => i.srs?.due)
    .sort((a, b) => a.srs!.due!.localeCompare(b.srs!.due!));
  const fresh = due
    .filter((i) => !i.srs?.due)
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  return [...seen, ...fresh].slice(0, Math.max(0, cap));
}

// W8 — fading scaffold tier for a due item, derived from how many times it has
// been reviewed. Honest limit: srs.reps counts FLASHCARD gradings, not unaided
// speech, so this is a coarse proxy — barely-seen items get a full model, well-
// reviewed ones must be produced independently. (B2's transcript signal can
// refine this later; see ROADMAP.) No new state: reads existing srs.reps.
export type ScaffoldTier = "model" | "cue" | "independent";

export function scaffoldTier(item: LearnedItem): ScaffoldTier {
  const reps = item.srs?.reps ?? 0;
  if (reps <= 0) return "model"; // new / never graded — model it, they repeat
  if (reps <= 2) return "cue"; // seen a little — a leading cue, they complete
  return "independent"; // well-practised — engineer the need, produce unaided
}

/** The blank shown in a cloze prompt. Long enough to read as a gap, not a dash. */
export const CLOZE_BLANK = "＿＿＿＿";

/**
 * E3 — build a cloze prompt from the item's own example sentence, with no model
 * call at all: the example usually CONTAINS the item, so blanking it out is a
 * string operation. Free, deterministic, offline, and higher quality than anything
 * generated — it is the sentence the learner actually met the word in.
 *
 * Returns null when the example is missing or doesn't contain the item (Japanese
 * conjugation, or an example that paraphrases). The caller then falls back to one
 * cached model call, so the model is the exception rather than the rule.
 *
 * Matching is case-insensitive (English capitalises sentence-initially) but never
 * fuzzy: a wrong blank would teach the wrong thing.
 */
export function clozeFromExample(item: LearnedItem): string | null {
  const example = item.example?.trim();
  const target = item.text?.trim();
  if (!example || !target) return null;
  // Blank EVERY occurrence. Blanking only the first leaves the answer sitting in
  // the same sentence ("Let's ＿＿ later; I'll circle back after lunch."), which
  // turns the recall test into a reading test.
  const haystack = example.toLocaleLowerCase();
  const needle = target.toLocaleLowerCase();
  let out = "";
  let from = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
    out += example.slice(from, at) + CLOZE_BLANK;
    from = at + target.length;
  }
  if (!from) return null; // never matched
  out += example.slice(from);
  // A "sentence" that is only the item itself teaches nothing once blanked.
  return out.split(CLOZE_BLANK).join("").trim() ? out : null;
}

/** E3 — the cloze prompt to show, preferring the free one over the cached call.
 *  A cached (model-written) cloze is VALIDATED, not trusted: the prompt asks it to
 *  keep the answer out and insert the blank, and it does not always comply. */
export function clozeFor(item: LearnedItem): string | null {
  const free = clozeFromExample(item);
  if (free) return free;
  const cached = item.cloze?.trim();
  if (!cached || !cached.includes(CLOZE_BLANK)) return null; // no gap = not a question
  const target = item.text?.trim().toLocaleLowerCase();
  if (target && cached.toLocaleLowerCase().includes(target)) return null; // answer leaked
  return cached;
}

function cardOf(item: LearnedItem, now: Date): Card {
  const raw = item.srs?.fsrs;
  if (!raw) return createEmptyCard(now);
  return {
    ...(raw as unknown as Card),
    due: new Date(raw.due as string),
    last_review: raw.last_review ? new Date(raw.last_review as string) : undefined,
  };
}

/** Apply one review rating; returns the item with its schedule advanced. */
export function rateItem(item: LearnedItem, rating: ReviewRating, now: Date): LearnedItem {
  const { card } = scheduler.next(cardOf(item, now), now, RATING[rating]);
  return {
    ...item,
    srs: {
      ...item.srs,
      due: card.due.toISOString(),
      intervalDays: card.scheduled_days,
      reps: card.reps,
      fsrs: {
        ...card,
        due: card.due.toISOString(),
        last_review: card.last_review?.toISOString(),
      },
    },
  };
}
