import { describe, expect, it } from "vitest";

import { SIMPLIFIED_TABLE_SIZE, quotedFrom, zhTw, zhTwProblem } from "./zhTw";
import { Invalid, arrayKeeping, nonEmptyString } from "./validate";

describe("zhTwProblem — closed-set Taiwan-Chinese check", () => {
  it("refuses Simplified characters and Mainland terms, naming the hit", () => {
    expect(zhTwProblem("请安装这个软件")).toBe("含簡體字『请』");
    expect(zhTwProblem("这个")).toBe("含簡體字『这』");
    expect(zhTwProblem("软件")).toBe("含簡體字『软』");
    expect(zhTwProblem("請看一下信息")).toBe("含中國用語『信息』（台灣用『資訊』）");
    expect(zhTwProblem("下載這個軟件")).toContain("『軟件』");
    expect(zhTwProblem("這是高質量的影片")).toContain("『高質量』");
    expect(zhTwProblem("這家店的質量很好")).toContain("『質量很好』");
  });

  it("passes Taiwan usage, English, empty text and Japanese (shared kanji are not in the table)", () => {
    for (const ok of [
      "這個軟體的資訊在螢幕上",
      "",
      "Let's check the deadline.",
      "会計の学校です",
      "交互に話しましょう",
      "這兩個變數有交互作用",
      "物體的質量是兩公斤",
      "這顆星球的質量很大",
    ]) {
      expect(zhTwProblem(ok)).toBeNull();
    }
  });

  it("keeps a table of at least 40 Simplified characters", () => {
    expect(SIMPLIFIED_TABLE_SIZE).toBeGreaterThanOrEqual(40);
  });
});

describe("quotedFrom — learner quotes are exempt, the rest is not", () => {
  it("removes only Han runs found verbatim in a source line", () => {
    const exempt = quotedFrom(["I bought 这个 bag"]);
    expect(exempt("「这个」很好")).toBe("「」很好");
    expect(zhTwProblem(exempt("「这个」很好"))).toBeNull();
    expect(zhTwProblem(exempt("这样比较好"))).toBe("含簡體字『这』");
  });
});

describe("zhTw — parser wrapper", () => {
  it("throws Invalid at the field path for a string, and at the entry path for a list", () => {
    expect(() => zhTw(nonEmptyString)("这个", "$.title")).toThrow(new Invalid("$.title", "含簡體字『这』"));
    expect(() => zhTw(arrayKeeping(nonEmptyString))(["好", "信息"], "$.wins")).toThrow("$.wins[1]: 含中國用語『信息』");
  });

  it("returns the parsed value unchanged when clean", () => {
    expect(zhTw(nonEmptyString)("  這個  ", "$")).toBe("這個");
    expect(zhTw(arrayKeeping(nonEmptyString))(["好", 3, "對"], "$")).toEqual(["好", "對"]);
  });
});
