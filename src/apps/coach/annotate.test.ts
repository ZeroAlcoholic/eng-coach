import { describe, expect, it } from "vitest";

import type { TranscriptTurn } from "../../kernel/types";
import { ANNOTATION_FIXTURES, FIXTURES } from "./ai/fixtures/transcripts";
import { annotateTurns, isHelpRequest, isOwnProduction, markL1FromFallbacks } from "./annotate";
import { HELP_TRIGGERS } from "./prompt";

/** Learner-turn indices (counting learner turns only) that carry `flag`. */
function flagged(turns: TranscriptTurn[], flag: "echo" | "aided" | "l1"): number[] {
  return turns.filter((t) => t.who === "user").flatMap((t, i) => (t[flag] ? [i] : []));
}

describe("annotateTurns — the six screening fixtures carry no flags", () => {
  for (const f of FIXTURES) {
    it(`${f.id}: zero echo / aided / l1`, () => {
      const out = annotateTurns(f.transcript, f.language);
      expect(flagged(out, "echo")).toEqual([]);
      expect(flagged(out, "aided")).toEqual([]);
      expect(flagged(out, "l1")).toEqual([]);
      expect(out.map((t) => t.text)).toEqual(f.transcript.map((t) => t.text)); // text untouched
    });
  }
});

describe("annotateTurns — the four annotation fixtures are flagged where a reader would", () => {
  for (const f of ANNOTATION_FIXTURES) {
    it(`${f.id}`, () => {
      const out = annotateTurns(f.transcript, f.language);
      expect(flagged(out, "echo")).toEqual(f.expectFlags?.echo ?? []);
      expect(flagged(out, "aided")).toEqual(f.expectFlags?.aided ?? []);
      expect(flagged(out, "l1")).toEqual(f.expectFlags?.l1 ?? []);
    });
  }

  it("Japanese practice never gets l1 from text alone — kana and kanji ARE the target language", () => {
    const ja = ANNOTATION_FIXTURES.find((f) => f.id === "ja-mixed")!;
    expect(flagged(annotateTurns(ja.transcript, "ja"), "l1")).toEqual([]);
  });
});

describe("annotateTurns — echo rule", () => {
  const coach = { who: "coach" as const, text: "Could you send me the report by Friday?" };

  it("a full sentence said back is an echo; word order and punctuation do not matter", () => {
    const out = annotateTurns([coach, { who: "user", text: "send me the report by friday, could you" }], "en");
    expect(out[1].echo).toBe(true);
  });

  it("a short answer that happens to reuse the coach's words is not an echo (below 3 words)", () => {
    const out = annotateTurns([coach, { who: "user", text: "By Friday." }], "en");
    expect(out[1].echo).toBeUndefined();
  });

  it("a line with the coach's words plus enough of the learner's own is not an echo (coverage < 0.8)", () => {
    const out = annotateTurns([coach, { who: "user", text: "I can send the report, but Monday is more realistic for me" }], "en");
    expect(out[1].echo).toBeUndefined();
  });

  it("only the coach's PREVIOUS line counts; an earlier line said back later is production", () => {
    const out = annotateTurns(
      [
        coach,
        { who: "user", text: "Sure." },
        { who: "coach", text: "Great, and what about the budget?" },
        { who: "user", text: "Could you send me the report by Friday?" },
      ],
      "en",
    );
    expect(out[3].echo).toBeUndefined();
  });

  it("Japanese: six characters of the coach's line said back is an echo; three is not", () => {
    const c = { who: "coach" as const, text: "しょうゆラーメンをひとつください。" };
    expect(annotateTurns([c, { who: "user", text: "しょうゆラーメン、ひとつください" }], "ja")[1].echo).toBe(true);
    expect(annotateTurns([c, { who: "user", text: "ひとつ" }], "ja")[1].echo).toBeUndefined();
  });

  it("the very first learner line (no coach line before it) is never an echo", () => {
    expect(annotateTurns([{ who: "user", text: "Hello there, good morning to you" }], "en")[0].echo).toBeUndefined();
  });
});

describe("annotateTurns — aided rule", () => {
  it("every HELP_TRIGGERS phrase marks the NEXT learner turn, not the request itself", () => {
    for (const trigger of HELP_TRIGGERS) {
      const out = annotateTurns(
        [
          { who: "coach", text: "What would you like?" },
          { who: "user", text: `這個${trigger}` },
          { who: "coach", text: "You can say: I'd like a coffee." },
          { who: "user", text: "I'd like a coffee." },
          { who: "coach", text: "Anything else?" },
          { who: "user", text: "No, that's all, thank you." },
        ],
        "en",
      );
      expect(flagged(out, "aided")).toEqual([1]);
    }
  });

  it("a request written in simplified script by the recogniser still counts", () => {
    expect(isHelpRequest("这个怎么说")).toBe(true);
    expect(isHelpRequest("翻译一下")).toBe(true);
    expect(isHelpRequest("慢一点")).toBe(true);
  });

  it("aidedTurnIdx: a button tap at transcript length k marks the first learner turn at index ≥ k", () => {
    const turns: TranscriptTurn[] = [
      { who: "coach", text: "Hi" },
      { who: "user", text: "Hi, I'm here for the meeting" },
      { who: "coach", text: "Which room?" },
      { who: "user", text: "Room four, I think" },
    ];
    // tapped after 2 turns existed (the coach's question had not arrived yet)
    expect(flagged(annotateTurns(turns, "en", [2]), "aided")).toEqual([1]);
    // tapped after everything: nothing follows → nothing marked
    expect(flagged(annotateTurns(turns, "en", [4]), "aided")).toEqual([]);
    // no taps → unchanged
    expect(flagged(annotateTurns(turns, "en"), "aided")).toEqual([]);
  });
});

describe("annotateTurns — l1 rule and the judge's backfill", () => {
  it("English practice: Han or kana anywhere in the learner turn marks it", () => {
    const out = annotateTurns(
      [
        { who: "user", text: "I want to 預約 a table" },
        { who: "user", text: "我不知道" },
        { who: "user", text: "I want to book a table" },
      ],
      "en",
    );
    expect(flagged(out, "l1")).toEqual([0, 1]);
  });

  it("markL1FromFallbacks marks the turns that contain what the judge quoted, and nothing else", () => {
    const ja = ANNOTATION_FIXTURES.find((f) => f.id === "ja-mixed")!;
    const out = markL1FromFallbacks(ja.transcript, [
      { said: "我想要" },
      { said: "幾點" },
      { said: "never said this" },
    ]);
    expect(flagged(out, "l1")).toEqual([0, 2]);
    expect(out.filter((t) => t.who === "coach").some((t) => t.l1)).toBe(false);
  });

  it("markL1FromFallbacks with nothing quoted returns the turns unchanged", () => {
    const turns: TranscriptTurn[] = [{ who: "user", text: "はい" }];
    expect(markL1FromFallbacks(turns, undefined)).toEqual(turns);
    expect(markL1FromFallbacks(turns, [{ said: "  " }])).toEqual(turns);
  });

  it("isOwnProduction: a learner turn with no flag; any flag or a coach turn is not", () => {
    expect(isOwnProduction({ who: "user", text: "x" })).toBe(true);
    expect(isOwnProduction({ who: "user", text: "x", echo: true })).toBe(false);
    expect(isOwnProduction({ who: "user", text: "x", aided: true })).toBe(false);
    expect(isOwnProduction({ who: "user", text: "x", l1: true })).toBe(false);
    expect(isOwnProduction({ who: "coach", text: "x" })).toBe(false);
  });

  it("flags already on the input survive re-annotation (a re-run never un-marks)", () => {
    const out = annotateTurns([{ who: "user", text: "はい、おねがいします", l1: true }], "ja");
    expect(out[0].l1).toBe(true);
  });
});
