// Layer-1 coaching frames: reusable, preset per target language, editable. These
// pre-fill Scenario.baseContext so the user rarely writes them by hand — they
// just drop in the Layer-2 content (the meeting brief / the specific place).

import type { TargetLanguage } from "../../kernel/types";

export const FRAME_PRESETS: Record<TargetLanguage, string> = {
  en:
    "Run a realistic English workplace/meeting role-play. Play the other party " +
    "in the meeting (a colleague, client, or stakeholder). Drive the conversation " +
    "so the learner has to explain ideas clearly, field questions, and negotiate. " +
    "Keep the register professional but natural.",
  ja:
    "旅行で役立つ日本語会話の練習相手になってください。旅行者が出会う現地の人" +
    "（店員・駅員・宿のスタッフ・道で尋ねる相手など）を演じ、実際の旅行で起こる" +
    "やりとりを自然に練習させてください。丁寧で分かりやすい話し方を心がけます。",
};
