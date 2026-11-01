// The output-side half of the Taiwan-Chinese rule (the prompt-side half is
// ZH_TW_RULE in apps/coach/ai/client.ts): a closed-set check a parser runs on
// every model-written Chinese field. A hit makes the parser throw `Invalid`, so
// the sample is refused through the same path as any malformed response — no
// second model call, no silent rewrite.
//
// Simplified characters: only forms that are NOT also Japanese shinjitai. 会 学
// 国 点 数 机 据 are shared with Japanese and with ordinary Taiwan writing, so a
// table holding them would refuse Japanese text; every character below is one
// Taiwan writing never uses and Japanese writes differently (这/這, 对/対).
//
// Mainland terms: matched as written in Traditional characters (the Simplified
// spellings already fail on the character table). 質量 and 交互 are also
// ordinary Taiwan words (physics mass; 交互作用), so only their Mainland
// collocations are listed — the bare word would refuse correct Taiwan text.

import { Invalid, type Parser } from "./validate";

const SIMPLIFIED = Array.from(
  "这说们时个发还对电车门问见东长为么吗让认话语请谢钱买卖题间关开进过现样种经动软视频质链标网务际线码级难远运边达应库",
);

const MAINLAND_TERMS: readonly (readonly [string, string])[] = [
  ["信息", "資訊"],
  ["軟件", "軟體"],
  ["視頻", "影片"],
  ["默認", "預設"],
  ["屏幕", "螢幕"],
  ["鼠標", "滑鼠"],
  ["鏈接", "連結"],
  ["數據庫", "資料庫"],
  ["高質量", "高品質"],
  ["質量很好", "品質很好"],
  ["質量很差", "品質很差"],
  ["質量不錯", "品質不錯"],
  ["產品質量", "產品品質"],
  ["服務質量", "服務品質"],
  ["人機交互", "人機互動"],
  ["交互設計", "互動設計"],
  ["交互界面", "互動介面"],
  ["交互體驗", "互動體驗"],
  ["用戶交互", "使用者互動"],
];

/** Why `text` is not Taiwan Traditional Chinese, or null when it passes. */
export function zhTwProblem(text: string): string | null {
  for (const ch of text) {
    if (SIMPLIFIED.includes(ch)) return `含簡體字『${ch}』`;
  }
  for (const [term, taiwan] of MAINLAND_TERMS) {
    if (text.includes(term)) return `含中國用語『${term}』（台灣用『${taiwan}』）`;
  }
  return null;
}

/** Wrap a parser of model-written Chinese so a hit refuses the value. Lists are
 *  checked after parsing: one bad entry refuses the whole value, it is not
 *  dropped, so a sample half in Mainland usage never lands. `exempt` removes
 *  text the model did not write (a verbatim quote of the learner) before the
 *  check; the returned value keeps it. */
export const zhTw =
  <T extends string | string[]>(inner: Parser<T>, exempt: (text: string) => string = (t) => t): Parser<T> =>
  (v, path) => {
    const out = inner(v, path);
    const texts: string[] = Array.isArray(out) ? out : [out];
    for (const [i, t] of texts.entries()) {
      const problem = zhTwProblem(exempt(t));
      if (problem) throw new Invalid(Array.isArray(out) ? `${path}[${i}]` : path, problem);
    }
    return out;
  };

/** An `exempt` for text that may quote these source lines: every run of Han
 *  characters found verbatim in a source line is removed. Speech recognition
 *  may write the learner's Chinese in Simplified form, and a judge quoting it
 *  is correct; refusing that sample would refuse every retry the same way. */
export const quotedFrom =
  (sources: readonly string[]) =>
  (text: string): string =>
    text.replace(/[一-鿿]+/g, (run) => (sources.some((s) => s.includes(run)) ? "" : run));

/** Size of the closed simplified-character table (a test pins its floor). */
export const SIMPLIFIED_TABLE_SIZE = SIMPLIFIED.length;
