import { describe, expect, it } from "vitest";

import type { LearnedItem } from "../../kernel/types";
import { itemsUsedIn, withUse } from "./uses";

const it_ = (id: string, text: string, sourceSessionId = "s0"): LearnedItem => ({
  id,
  language: "en",
  kind: "phrase",
  text,
  meaning: "m",
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  sourceSessionId,
});

describe("chunk-use tracking — an item counts as used only when the learner said it", () => {
  it("matches learner turns, case-insensitively, and ignores coach turns", () => {
    const items = [it_("a", "circle back"), it_("b", "touch base")];
    const used = itemsUsedIn(
      items,
      [
        { who: "coach", text: "Let's touch base tomorrow." },
        { who: "user", text: "Can we Circle Back on Friday?" },
      ],
      "en",
    );
    expect(used.map((i) => i.id)).toEqual(["a"]);
  });

  it("ignores items of another language and one-character items", () => {
    const items = [{ ...it_("ja", "を"), language: "ja" as const }, it_("one", "a")];
    expect(itemsUsedIn(items, [{ who: "user", text: "a を" }], "en")).toEqual([]);
  });

  it("being taught is not using: the item's own source session never counts", () => {
    expect(withUse(it_("a", "x", "s1"), "s1", "t")).toBeNull();
  });

  it("the same session is recorded once", () => {
    const once = withUse(it_("a", "x"), "s2", "t")!;
    expect(once.uses).toHaveLength(1);
    expect(withUse(once, "s2", "t")).toBeNull();
  });
});
