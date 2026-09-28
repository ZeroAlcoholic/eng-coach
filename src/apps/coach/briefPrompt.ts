// The one-tap prompt for turning raw material (a meeting invite, an itinerary,
// a chat log, a web page) into a practice brief with another assistant. The
// learner copies this, pastes it into ChatGPT / Gemini / Claude together with
// their material, and pastes the Markdown answer back into「練習簡報」or saves
// it as .md and imports it. The shape asked for is exactly what
// ai/scenario.ts and ai/arc.ts extract best from: one situation, two roles,
// a handful of objectives, a few phrases. Pure text — no model call here.

import type { CEFRLevel, TargetLanguage } from "../../kernel/types";

const LANG_ZH: Record<TargetLanguage, string> = { en: "英文", ja: "日文" };

export function briefPrompt(input: { language: TargetLanguage; level: CEFRLevel; serial: boolean }): string {
  const lang = LANG_ZH[input.language];
  const shape = input.serial
    ? `一條約 6 集的連續劇：每一集是同一個故事裡的下一個場景，同一批角色貫穿，集與集之間有「還沒解決的事」把人拉去下一集。`
    : `一個可以直接開練的單場情境。`;
  const extraSerial = input.serial
    ? `
## 主要角色
- （2 到 3 位會反覆出現的人：名字、身分、一句話的性格）

## 六集大綱
1. （第 1 集發生什麼）
2. …
6. （最後一集怎麼收尾）

## 還沒解決的事
- （1 到 2 件在故事開始時就存在、會推動後面幾集的事）
`
    : "";
  return `我在用一個語音口說練習 app 練${lang}（CEFR ${input.level}）。請把下面「我的材料」整理成${shape}用繁體中文（台灣用語）寫，只輸出 Markdown，照這個格式：

# 標題
（10 字以內）

## 情境
（3 到 5 句：在哪裡、發生什麼事、我要達成什麼。要具體，有人名、地點、數字更好。）

## 角色
- 對方：（教練要扮演誰、什麼個性）
- 我：（我扮演誰）

## 這次要練的事
- （3 到 5 條，每條是一件我要「做到」的事，例如「能說明延遲的原因並道歉」）

## 可能用到的${lang}句子
- （5 到 8 句，${input.language === "ja" ? "日文後面加括號寫羅馬拼音，" : ""}程度要符合 CEFR ${input.level}）
${extraSerial}
規則：不要加解釋、不要加練習題、不要評分；材料裡沒有的細節可以合理補上，但不要改變材料的事實。

我的材料：
（把你的會議通知、行程、對話紀錄或網頁內容貼在這裡）`;
}
