import { describe, expect, it } from "vitest";

import type { LearnedItem } from "../../kernel/types";
import { frameAnchors, itemsUsedIn, matchesFrame, withUse } from "./uses";

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

  it("a turn that echoes the coach, follows help, or contains Chinese is not the learner's own production", () => {
    const items = [it_("a", "circle back")];
    expect(itemsUsedIn(items, [{ who: "user", text: "let's circle back", echo: true }], "en")).toEqual([]);
    expect(itemsUsedIn(items, [{ who: "user", text: "let's circle back", aided: true }], "en")).toEqual([]);
    expect(itemsUsedIn(items, [{ who: "user", text: "我們 circle back", l1: true }], "en")).toEqual([]);
    expect(itemsUsedIn(items, [{ who: "user", text: "let's circle back" }], "en")).toHaveLength(1);
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

describe("chunk-use tracking — grammar frames match by anchors in order", () => {
  const frame = (id: string, frameText: string): LearnedItem => ({ ...it_(id, "would rather"), kind: "grammar", frame: frameText });

  it("「I'd rather stay than go」 fills「I'd rather ___ than ___」", () => {
    const used = itemsUsedIn([frame("f", "I'd rather ___ than ___")], [{ who: "user", text: "I'd rather stay than go." }], "en");
    expect(used.map((i) => i.id)).toEqual(["f"]);
  });

  it("anchors in the wrong order do not match", () => {
    // both anchors present, "than" before "i'd rather"
    const used = itemsUsedIn([frame("f", "I'd rather ___ than ___")], [{ who: "user", text: "More than anything, I'd rather stay." }], "en");
    expect(used).toEqual([]);
  });

  it("a curly apostrophe from the recogniser still matches a straight one in the frame", () => {
    const used = itemsUsedIn([frame("f", "I'd rather ___ than ___")], [{ who: "user", text: "I\u2019d rather stay than go." }], "en");
    expect(used.map((i) => i.id)).toEqual(["f"]);
  });

  it("anchors must sit inside ONE learner turn, not across two", () => {
    const used = itemsUsedIn(
      [frame("f", "I'd rather ___ than ___")],
      [
        { who: "user", text: "I'd rather stay." },
        { who: "user", text: "Better than going." },
      ],
      "en",
    );
    expect(used).toEqual([]);
  });

  it("a frame whose characters would mean something in a regex is still a plain string", () => {
    const anchors = frameAnchors("as ___ as .* (___)");
    expect(matchesFrame("as big as .* (that)", anchors)).toBe(true);
    expect(matchesFrame("as big as anything (that)", anchors)).toBe(false);
  });

  it("a frame with no usable anchor never matches", () => {
    expect(frameAnchors("___ ___")).toEqual([]);
    expect(matchesFrame("anything at all", [])).toBe(false);
  });

  it("an item without a frame keeps the whole-text rule (behaviour unchanged)", () => {
    const used = itemsUsedIn([it_("p", "would rather")], [{ who: "user", text: "I would rather stay." }], "en");
    expect(used.map((i) => i.id)).toEqual(["p"]);
  });
});
