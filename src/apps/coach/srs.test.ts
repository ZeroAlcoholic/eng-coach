import { describe, expect, it } from "vitest";

import { CLOZE_BLANK, clozeFor, clozeFromExample } from "./srs";

const clozeItem = (over: Partial<import("../../kernel/types").LearnedItem>) => ({
  id: "c1",
  language: "en" as const,
  kind: "phrase" as const,
  text: "circle back",
  meaning: "稍後再談",
  firstSeenAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

describe("E3 clozeFromExample — the free, offline cloze", () => {
  it("blanks the item out of its own example sentence", () => {
    const out = clozeFromExample(clozeItem({ example: "Let's circle back on that tomorrow." }));
    expect(out).toBe(`Let's ${CLOZE_BLANK} on that tomorrow.`);
    expect(out).not.toContain("circle back"); // the answer must not leak
  });

  it("matches case-insensitively (English capitalises sentence-initially)", () => {
    expect(clozeFromExample(clozeItem({ example: "Circle back later, please." }))).toBe(
      `${CLOZE_BLANK} later, please.`,
    );
  });

  it("returns null rather than guessing when the example doesn't contain the item", () => {
    expect(clozeFromExample(clozeItem({ example: "We will discuss it later." }))).toBeNull();
    expect(clozeFromExample(clozeItem({ example: "" }))).toBeNull();
    expect(clozeFromExample(clozeItem({}))).toBeNull();
  });

  it("rejects an example that is nothing but the item — blanking it teaches nothing", () => {
    expect(clozeFromExample(clozeItem({ example: "circle back" }))).toBeNull();
    expect(clozeFromExample(clozeItem({ example: "  circle back  " }))).toBeNull();
  });

  it("handles Japanese items, where the example often lacks the dictionary form", () => {
    const ja = clozeItem({ language: "ja", text: "お願いします", example: "チェックインお願いします。" });
    expect(clozeFromExample(ja)).toBe(`チェックイン${CLOZE_BLANK}。`);
    const conjugated = clozeItem({ language: "ja", text: "行く", example: "駅まで行きます。" });
    expect(clozeFromExample(conjugated)).toBeNull(); // 行きます ≠ 行く — don't force it
  });
});

describe("E3 clozeFromExample — the answer must never survive in the prompt", () => {
  it("blanks EVERY occurrence, not only the first", () => {
    const out = clozeFromExample(
      clozeItem({ example: "Let's circle back later; I'll circle back after lunch." }),
    );
    expect(out).toBe(`Let's ${CLOZE_BLANK} later; I'll ${CLOZE_BLANK} after lunch.`);
    expect(out?.toLowerCase()).not.toContain("circle back");
  });
});

describe("E3 clozeFor — prefer the free cloze, and VALIDATE the cached one", () => {
  it("uses the example-derived cloze even when a cached one exists", () => {
    const item = clozeItem({ example: "Let's circle back later.", cloze: `A cached ${CLOZE_BLANK}.` });
    expect(clozeFor(item)).toBe(`Let's ${CLOZE_BLANK} later.`);
  });

  it("falls back to the cached cloze, and to null when there is neither", () => {
    expect(clozeFor(clozeItem({ cloze: `Please ${CLOZE_BLANK} tomorrow.` }))).toBe(
      `Please ${CLOZE_BLANK} tomorrow.`,
    );
    expect(clozeFor(clozeItem({ cloze: "   " }))).toBeNull();
    expect(clozeFor(clozeItem({}))).toBeNull();
  });

  // The model is ASKED to insert the blank and withhold the answer; it does not
  // always comply, and an unvalidated cache would show the answer as the question.
  it("rejects a cached cloze with no blank, or one that leaks the answer", () => {
    expect(clozeFor(clozeItem({ cloze: "Let's circle back on that tomorrow." }))).toBeNull();
    expect(clozeFor(clozeItem({ cloze: `Let's ${CLOZE_BLANK}, then circle back.` }))).toBeNull();
    expect(clozeFor(clozeItem({ cloze: `Let's ${CLOZE_BLANK} on that tomorrow.` }))).toBe(
      `Let's ${CLOZE_BLANK} on that tomorrow.`,
    );
  });
});

import type { LearnedItem } from "../../kernel/types";
import { countDue, dueQueue, isDue, rateItem, scaffoldTier } from "./srs";

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

describe("scaffoldTier — W8 fading scaffold from review history", () => {
  it("gives a new / never-graded item the full model", () => {
    expect(scaffoldTier(item())).toBe("model");
    expect(scaffoldTier(item({ srs: { reps: 0 } }))).toBe("model");
  });
  it("steps down to a leading cue for a lightly-reviewed item", () => {
    expect(scaffoldTier(item({ srs: { reps: 1 } }))).toBe("cue");
    expect(scaffoldTier(item({ srs: { reps: 2 } }))).toBe("cue");
  });
  it("demands independent production once it's well-practised", () => {
    expect(scaffoldTier(item({ srs: { reps: 3 } }))).toBe("independent");
    expect(scaffoldTier(item({ srs: { reps: 9 } }))).toBe("independent");
  });
});
