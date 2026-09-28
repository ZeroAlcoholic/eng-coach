import { describe, expect, it } from "vitest";

import { BRIEF_RULES } from "./ai/client";
import { MATERIAL_PLACEHOLDER, MAX_BRIEF_CHARS, briefProblem, briefPrompt, looksLikeText } from "./briefPrompt";

describe("briefPrompt — the hand-off prompt for another assistant", () => {
  it("asks for the sections the generator extracts from, in Taiwan Traditional Chinese, for the chosen language and level", () => {
    const p = briefPrompt({ language: "en", level: "B1", serial: false });
    for (const h of ["# 標題", "## 情境", "## 角色", "## 這次要練的事", "## 可能用到的英文句子", "我的材料"]) expect(p).toContain(h);
    expect(p).toContain("CEFR B1");
    expect(p).not.toContain("六集大綱");
    expect(p).toContain("繁體中文（台灣用語）");
  });

  it("a serial brief adds the cast, the six-episode outline and the open threads", () => {
    const p = briefPrompt({ language: "en", level: "B2", serial: true });
    expect(p).toContain("約 6 集的連續劇");
    expect(p).toContain("## 主要角色");
    expect(p).toContain("## 六集大綱");
    expect(p).toContain("## 還沒解決的事");
  });

  it("Japanese asks for romaji after each sentence", () => {
    const p = briefPrompt({ language: "ja", level: "A2", serial: false });
    expect(p).toContain("日文句子");
    expect(p).toContain("羅馬拼音");
    expect(briefPrompt({ language: "en", level: "A2", serial: false })).not.toContain("羅馬拼音");
  });

  it("contains no simplified-only Chinese characters", () => {
    const SIMPLIFIED_ONLY = "盘个东们说过还这来时对国动务够无为写师买话记华门产电业发风气长开关闭见观点热让认识计设语讲课题练习价钱边远进达运车轮传统结构续级红绿蓝黑体验据么儿实现场问题师约图书馆办";
    for (const serial of [true, false]) {
      const p = briefPrompt({ language: "ja", level: "A1", serial });
      expect([...new Set(p)].filter((ch) => SIMPLIFIED_ONLY.includes(ch))).toEqual([]);
    }
  });

  it("turns a presentation or report into Q&A: key facts plus the questions the other side will ask, in the target language", () => {
    const p = briefPrompt({ language: "en", level: "B1", serial: false });
    expect(p).toContain("## 材料重點");
    expect(p).toContain("## 對方可能會問的問題");
    expect(p).toMatch(/用英文寫/);
    expect(p).toMatch(/簡報、報告/);
    expect(p.trim().endsWith(MATERIAL_PLACEHOLDER)).toBe(true);
  });

  it("every section the prompt asks for is one the generator is told to honour", () => {
    const headings = [...briefPrompt({ language: "en", level: "B1", serial: false }).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    for (const h of headings) expect(BRIEF_RULES).toContain(h.replace("英文", ""));
  });
});

describe("briefProblem — refused before any paid call", () => {
  it("an empty brief", () => {
    expect(briefProblem("  \n ")).toMatch(/請先貼上/);
  });

  it("the prompt itself pasted back without the other assistant's answer", () => {
    expect(briefProblem(briefPrompt({ language: "ja", level: "A2", serial: true }))).toMatch(/提示詞本身/);
  });

  it("a whole document pasted instead of a brief", () => {
    expect(briefProblem("a".repeat(MAX_BRIEF_CHARS + 1))).toMatch(/太長/);
    expect(briefProblem("a".repeat(MAX_BRIEF_CHARS))).toBeNull();
  });

  it("a real brief passes", () => {
    expect(briefProblem("# 季度預算\n## 情境\n向美國團隊說明 10% 增幅。")).toBeNull();
  });
});

describe("looksLikeText — a binary file picked despite `accept`", () => {
  it("plain Markdown and empty text are text", () => {
    expect(looksLikeText("# 標題\n## 情境\nSome English.")).toBe(true);
    expect(looksLikeText("")).toBe(true);
  });

  it("a zip/pdf decoded as UTF-8 is not", () => {
    expect(looksLikeText("PK\u0003\u0004\u0000\u0000��\u0000[Content_Types].xml�\u0000")).toBe(false);
  });
});
