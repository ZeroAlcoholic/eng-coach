import { describe, expect, it } from "vitest";

import { parseRawItems, validFrame } from "./items";

describe("item validator — a frame is kept only when it can match its own example", () => {
  it("keeps a grammar frame whose anchors all occur in the example", () => {
    expect(validFrame("I'd rather ___ than ___", "grammar", "I'd rather stay than go")).toBe("I'd rather ___ than ___");
  });

  it("drops a frame with an anchor the example does not contain", () => {
    expect(validFrame("I'd rather ___ than ___", "grammar", "I prefer staying")).toBeUndefined();
  });

  it("drops a frame with no anchor of two or more characters", () => {
    expect(validFrame("___ ___", "grammar", "stay go")).toBeUndefined();
    expect(validFrame("a ___", "grammar", "a dog")).toBeUndefined();
  });

  it("drops a frame on a word or phrase item, and on a grammar item without an example", () => {
    expect(validFrame("___ back", "phrase", "circle back")).toBeUndefined();
    expect(validFrame("I'd rather ___", "grammar", undefined)).toBeUndefined();
  });

  it("parseRawItems: a bad frame drops the frame, not the item; a bad item drops only itself", () => {
    const out = parseRawItems(
      {
        items: [
          { kind: "grammar", text: "would rather", meaning: "寧願", example: "I'd rather stay than go", frame: "I'd rather ___ than ___" },
          { kind: "grammar", text: "used to", meaning: "過去習慣", example: "I used to swim", frame: "I ___ to ___ nope" },
          { kind: "word", text: "book", meaning: "預約", example: "I'd like to book a table for two." },
          { kind: "noun", text: "x", meaning: "y" },
        ],
      },
      "$",
    );
    expect(out).toEqual([
      { kind: "grammar", text: "would rather", meaning: "寧願", example: "I'd rather stay than go", frame: "I'd rather ___ than ___" },
      { kind: "grammar", text: "used to", meaning: "過去習慣", example: "I used to swim" },
      { kind: "word", text: "book", meaning: "預約", example: "I'd like to book a table for two." },
    ]);
  });

  it("code-mixing: the extractor's fixed reply for「預約」is stored as the target-language word with the coach's example", () => {
    // The model's JSON for the en-mixed fixture, pinned by hand: what matters is
    // that the parser keeps the English item and the coach's English sentence.
    const out = parseRawItems(
      { items: [{ kind: "word", text: "book", meaning: "預約", example: "I'd like to book a table." }] },
      "$",
    );
    expect(out[0]).toMatchObject({ text: "book", example: "I'd like to book a table." });
    expect(out[0].text).not.toMatch(/\p{Script=Han}/u);
  });
});
