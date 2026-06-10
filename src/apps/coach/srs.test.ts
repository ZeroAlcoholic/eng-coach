import { describe, expect, it } from "vitest";

import type { LearnedItem } from "../../kernel/types";
import { countDue, dueQueue, isDue, rateItem } from "./srs";

const NOW = new Date("2026-06-10T12:00:00.000Z");

function item(over: Partial<LearnedItem> = {}): LearnedItem {
  return {
    id: "id-1",
    language: "en",
    kind: "word",
    text: "leverage",
    meaning: "槓桿；利用",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("isDue", () => {
  it("treats an item with no srs as a new card, due now", () => {
    expect(isDue(item(), NOW)).toBe(true);
  });
  it("respects a future due date", () => {
    expect(isDue(item({ srs: { due: "2026-06-11T00:00:00.000Z" } }), NOW)).toBe(false);
    expect(isDue(item({ srs: { due: "2026-06-09T00:00:00.000Z" } }), NOW)).toBe(true);
  });
});

describe("rateItem", () => {
  it("schedules into the future and counts the rep", () => {
    const rated = rateItem(item(), "good", NOW);
    expect(new Date(rated.srs!.due!).getTime()).toBeGreaterThan(NOW.getTime());
    expect(rated.srs!.reps).toBe(1);
    expect(rated.srs!.fsrs).toBeDefined();
  });

  it("'again' comes back sooner than 'easy'", () => {
    const again = rateItem(item(), "again", NOW);
    const easy = rateItem(item(), "easy", NOW);
    expect(new Date(again.srs!.due!).getTime()).toBeLessThan(new Date(easy.srs!.due!).getTime());
  });

  it("round-trips the serialized card across reviews", () => {
    const first = rateItem(item(), "good", NOW);
    const later = new Date(first.srs!.due!);
    const second = rateItem(first, "good", later);
    expect(second.srs!.reps).toBe(2);
    expect(new Date(second.srs!.due!).getTime()).toBeGreaterThan(later.getTime());
  });

  it("does not mutate the input item", () => {
    const original = item();
    rateItem(original, "good", NOW);
    expect(original.srs).toBeUndefined();
  });
});

describe("dueQueue / countDue", () => {
  const seen = item({ id: "seen", srs: { due: "2026-06-09T00:00:00.000Z" } });
  const fresh = item({ id: "fresh" });
  const notDue = item({ id: "later", srs: { due: "2026-07-01T00:00:00.000Z" } });
  const ja = item({ id: "ja", language: "ja" });

  it("puts overdue seen cards before new ones, filters language and not-due", () => {
    const q = dueQueue([fresh, notDue, ja, seen], "en", NOW, 10);
    expect(q.map((i) => i.id)).toEqual(["seen", "fresh"]);
  });

  it("caps the queue", () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: `i${i}` }));
    expect(dueQueue(many, "en", NOW, 20)).toHaveLength(20);
  });

  it("counts due items per language", () => {
    expect(countDue([fresh, notDue, ja, seen], "en", NOW)).toBe(2);
    expect(countDue([fresh, notDue, ja, seen], "ja", NOW)).toBe(1);
  });
});
