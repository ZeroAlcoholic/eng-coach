import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SessionReview } from "../../kernel/types";
import type { FinalizeOutcome } from "./finalize";
import { Recap, ReviewBody, ReviewDetails } from "./Recap";

const review: SessionReview = {
  cefr: "B1",
  subscores: { grammar: 3, vocab: 3, fluency: 3, interaction: 4 },
  reviewEn: "Nice job keeping the conversation going.",
  reviewZh: "對話撐得很好喔。",
  progressNote: "past tense of irregular verbs",
  wins: ["主動問了早餐時間", "第二個優點"],
  fixes: ["I goed → I went", "第二個修正"],
  objectivesMet: [{ objective: "用訂房姓名辦理入住", met: true }],
  errors: [{ type: "tense", example: "I goed", correction: "I went" }],
};

const done = { kind: "done", judge: { kind: "review", review, samples: 1 }, items: 3, itemsFailed: false } as unknown as FinalizeOutcome;
const already = { kind: "already", review } as unknown as FinalizeOutcome;
const html = (outcome: FinalizeOutcome) => renderToStaticMarkup(createElement(Recap, { outcome, scenarioId: "s1" }));

describe("Recap — one focus by default (U3)", () => {
  for (const [name, outcome] of [
    ["done", done],
    ["already", already],
  ] as const) {
    it(`${name}: shows the self-check, the first win and the first fix — no 文法, no CEFR, no second items`, () => {
      const out = html(outcome);
      expect(out).toContain("用訂房姓名辦理入住");
      expect(out).toContain("主動問了早餐時間");
      expect(out).toContain("I goed → I went");
      expect(out).toContain("看完整回顧");
      for (const hidden of ["文法", "CEFR", "第二個優點", "第二個修正", "對話撐得很好", "錯誤型態", "下次重點"]) {
        expect(out, hidden).not.toContain(hidden);
      }
    });
  }

  it("expanded: everything else is there", () => {
    const out = renderToStaticMarkup(createElement(ReviewDetails, { review }));
    for (const shown of ["本次 CEFR B1", "文法", "詞彙", "對話撐得很好", "Nice job", "第二個優點", "第二個修正", "錯誤型態", "下次重點"]) {
      expect(out, shown).toContain(shown);
    }
    expect(out).not.toContain("主動問了早餐時間"); // the first ones are already shown above
  });

  it("the toggle's open state renders the details below the summary, with the 收起 label", () => {
    const closed = renderToStaticMarkup(createElement(ReviewBody, { review, scenarioId: "s1" }));
    const open = renderToStaticMarkup(createElement(ReviewBody, { review, scenarioId: "s1", defaultFull: true }));
    expect(closed).not.toContain("文法");
    expect(open).toContain("文法");
    expect(open).toContain("本次 CEFR B1");
    expect(open).toContain("收起完整回顧");
    expect(open.indexOf("主動問了早餐時間")).toBeLessThan(open.indexOf("文法"));
  });

  it("no review: the unavailable branch is unchanged (reason shown, no toggle)", () => {
    const unavailable = { kind: "done", judge: { kind: "unavailable", reason: "學習者沒有開口", retryable: false }, items: 0, itemsFailed: false } as unknown as FinalizeOutcome;
    const out = html(unavailable);
    expect(out).toContain("這場沒有評量");
    expect(out).not.toContain("看完整回顧");
  });
});
