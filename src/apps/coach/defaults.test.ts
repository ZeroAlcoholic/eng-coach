import { describe, expect, it } from "vitest";

import { zhTwProblem } from "../../kernel/zhTw";
import { DEFAULT_SCENARIOS } from "./defaults";

const ALL = [...DEFAULT_SCENARIOS.en, ...DEFAULT_SCENARIOS.ja];

// The ids every build has shipped. A practised default is stored under its id,
// so renaming one would orphan the learner's history for it.
const SHIPPED_IDS = [
  "def-en-vendor-demo",
  "def-en-strategy-report",
  "def-en-gartner",
  "def-en-consultant",
  "def-en-status-update",
  "def-en-defend-position",
  "def-en-networking",
  "def-en-flight-trouble",
  "def-en-business-dinner",
  "def-ja-restaurant",
  "def-ja-ramen",
  "def-ja-cafe",
  "def-ja-conbini",
  "def-ja-luggage",
  "def-ja-train",
  "def-ja-directions",
  "def-ja-shopping",
  "def-ja-pharmacy",
  "def-ja-onsen",
  "def-ja-izakaya",
  "def-ja-lost-item",
  "def-ja-clinic",
  "def-ja-shinkansen",
  "def-en-ica-governance-qa",
  "def-en-ica-iaj-docai",
  "def-en-ica-iaj-education",
  "def-en-ica-ssr-backtest",
  "def-en-ica-fraud-ethics",
  "def-en-ica-policyqa-regulator",
  "def-en-ica-press-interview",
  "def-en-ica-llm-qa-advice",
  "def-en-ica-session-chair",
  "def-ja-ica-meishi",
];

// A named person leads the role — English track "First Last，…", Japanese
// track a surname + さん／先生 (after an optional 先扮演…) — and the same name
// appears in the situation, so the role and the story name one counterpart.
const PERSON_EN = /^([A-Z][a-z]+ [A-Z][a-z]+)，/;
const PERSON_JA = /^(?:先扮演[^，；：]*?)?([一-鿿]{1,3}(?:さん|先生))/;

describe("built-in scenarios read as a situation, in Taiwan Chinese (I5)", () => {
  it("keep exactly the shipped stable ids", () => {
    expect(ALL.map((s) => s.id).sort()).toEqual([...SHIPPED_IDS].sort());
  });

  for (const s of ALL) {
    it(`${s.id}: Taiwan Chinese, no practice-talk, a named counterpart`, () => {
      for (const text of [s.title, s.contentContext, s.coachRole, s.userRole, ...s.objectives]) {
        expect(zhTwProblem(text), text).toBeNull();
      }
      for (const meta of ["練習", "不是", "流暢度"]) expect(s.contentContext).not.toContain(meta);
      const name = s.coachRole.match(s.targetLanguage === "en" ? PERSON_EN : PERSON_JA)?.[1];
      expect(name, s.coachRole).toBeTruthy();
      expect(s.contentContext).toContain(name);
    });
  }

  it("Japanese-track descriptions, learner roles and objectives are Chinese: kana are at most a quoted term", () => {
    // Chinese text may quote a short Japanese term (お通し、みどりの窓口、佐藤さん);
    // a Japanese sentence is mostly kana. The old Japanese-only descriptions were over half kana.
    const kanaShare = (t: string) => {
      const cjk = [...t].filter((c) => /[぀-ヿ一-鿿]/.test(c));
      return cjk.filter((c) => /[぀-ヿ]/.test(c)).length / Math.max(1, cjk.length);
    };
    expect(kanaShare("京都の定食屋で夕食。メニューは日本語だけなので、店員におすすめを聞いてから注文する。")).toBeGreaterThan(0.3);
    for (const s of DEFAULT_SCENARIOS.ja) {
      for (const text of [s.contentContext, s.userRole, ...s.objectives]) expect(kanaShare(text), text).toBeLessThan(0.3);
    }
  });
});
