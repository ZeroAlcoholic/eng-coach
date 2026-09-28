// The one-tap prompt for turning raw material (a meeting invite, a slide deck,
// a report, an itinerary, a chat log) into a practice brief with another
// assistant. The learner copies this, pastes it into ChatGPT / Gemini / Claude
// together with their material, and pastes the Markdown answer back into
//「練習簡報」or saves it as .md and imports it. The shape asked for is exactly
// what ai/scenario.ts and ai/arc.ts extract best from: one situation, two
// roles, a handful of objectives, a few phrases, the questions the coach will
// ask. Pure text — no model call here.

import type { CEFRLevel, TargetLanguage } from "../../kernel/types";

const LANG_ZH: Record<TargetLanguage, string> = { en: "英文", ja: "日文" };

// The last line of the prompt. If a brief still contains it, the learner pasted
// the prompt itself instead of the other assistant's answer.
export const MATERIAL_PLACEHOLDER = "（把你的會議通知、簡報、報告、行程或對話紀錄貼在這裡，或直接附上檔案）";

export function briefPrompt(input: { language: TargetLanguage; level: CEFRLevel; serial: boolean }): string {
  const lang = LANG_ZH[input.language];
  const romaji = input.language === "ja" ? "日文後面加括號寫羅馬拼音，" : "";
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

## 材料重點
- （3 到 6 條：材料裡最重要的事實、數字、結論，練習時會被拿來問）

## 角色
- 對方：（教練要扮演誰、什麼個性）
- 我：（我扮演誰）

## 這次要練的事
- （3 到 5 條，每條是一件我要「做到」的事，例如「能說明延遲的原因並道歉」）

## 對方可能會問的問題
- （5 到 8 題，用${lang}寫，${romaji}從容易到有挑戰性，要緊扣材料重點）

## 可能用到的${lang}句子
- （5 到 8 句，${romaji}程度要符合 CEFR ${input.level}）
${extraSerial}
規則：
- 如果材料是簡報、報告、提案或文件：情境設成「我向對方說明這份內容，然後接受提問」，對方扮演會追問的聽眾、主管或客戶，問題要針對內容本身（數字的根據、風險、下一步）。
- 不要加解釋、不要加練習題、不要評分；材料裡沒有的細節可以合理補上，但不要改變材料的事實。

我的材料：
${MATERIAL_PLACEHOLDER}`;
}

// A brief is a page of notes, not the material itself. Past these a paste is
// almost certainly a whole document: slow and costly to send, and the generator
// extracts a scenario worse from it than from a summary.
export const MAX_BRIEF_CHARS = 100_000;
export const MAX_BRIEF_FILE_BYTES = 1_000_000;

/** Why this brief should not be sent to the generator yet, or null when it is fine.
 *  Checked before any paid call, so a mistake costs nothing. */
export function briefProblem(brief: string): string | null {
  const t = brief.trim();
  if (!t) return "請先貼上簡報或匯入 Markdown。";
  if (t.includes(MATERIAL_PLACEHOLDER))
    return "這是提示詞本身，還沒有附上你的材料。請把它貼到 ChatGPT／Gemini／Claude 並附上材料，再把對方的回覆貼回來。";
  if (t.length > MAX_BRIEF_CHARS)
    return `簡報太長（${t.length.toLocaleString()} 字，上限 ${MAX_BRIEF_CHARS.toLocaleString()}）。請先用「複製提示詞」請 ChatGPT／Gemini 整理成重點再貼回來。`;
  return null;
}

/** A file picker may hand over a .pptx / .pdf / .docx despite `accept` (some
 *  Android pickers ignore it). Decoded as text those are mostly NUL bytes and
 *  U+FFFD, which would land in the brief as garbage. */
export function looksLikeText(s: string): boolean {
  if (!s) return true;
  const sample = s.slice(0, 4000);
  let bad = 0;
  for (const ch of sample) if (ch === "\u0000" || ch === "�") bad++;
  return bad / sample.length < 0.01;
}
