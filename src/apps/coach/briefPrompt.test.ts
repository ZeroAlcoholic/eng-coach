import { describe, expect, it } from "vitest";

import { briefPrompt } from "./briefPrompt";

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
});
