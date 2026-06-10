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
