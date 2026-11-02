import { describe, expect, it } from "vitest";

import { strayScript } from "./strayScript";

describe("strayScript — letters from a language the coach never speaks", () => {
  it("flags Vietnamese, Cyrillic, Thai and Hangul runs", () => {
    expect(strayScript("今天就練 đến這裡。")).toEqual(["đế"]);
    expect(strayScript("Привет, 안녕, สวัสดี")).toEqual(["Привет", "안녕", "สวัสดี"]);
    expect(strayScript("ơi thư ăn ㅎㅎ")).toEqual(["ơ", "ư", "ă", "ㅎㅎ"]);
  });

  it("passes Taiwan Chinese, Japanese and English with Latin-1 accents", () => {
    expect(strayScript("今天就練到這裡。はじめまして。ㄅㄆㄇ。A café résumé, naïve.")).toEqual([]);
  });
});
