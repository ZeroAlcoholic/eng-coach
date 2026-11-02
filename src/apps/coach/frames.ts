// Layer-1 coaching frames: reusable, preset per target language, editable. These
// pre-fill Scenario.baseContext so the user rarely writes them by hand — they
// just drop in the Layer-2 content (the meeting brief / the specific place).

import type { TargetLanguage } from "../../kernel/types";

// The closing check lives once, so the presets and the congress frames cannot
// drift apart on how a session ends.
export const EN_CLOSING_CHECK = "near the end briefly check the learner can now do the scenario's objectives unaided.";
export const JA_CLOSING_CHECK = "最後に学習者がそのタスクを一人でできるかを軽く確認してください。";
const EN_ENDING =
  "Recycle the scenario's target " +
  "phrases naturally in your own turns so the learner hears them in context, and " +
  EN_CLOSING_CHECK;
const JA_ENDING = "シナリオの目標フレーズを自分のセリフにも自然に織り込んで聞かせ、" + JA_CLOSING_CHECK;

export const FRAME_PRESETS: Record<TargetLanguage, string> = {
  en:
    "Run a realistic English workplace/meeting role-play. Play the other party " +
    "in the meeting (a colleague, client, or stakeholder). Drive the conversation " +
    "so the learner has to explain ideas clearly, field questions, and negotiate. " +
    "Keep the register professional but natural. " +
    EN_ENDING,
  ja:
    "旅行で役立つ日本語会話の練習相手になってください。旅行者が出会う現地の人" +
    "（店員・駅員・宿のスタッフ・道で尋ねる相手など）を演じ、実際の旅行で起こる" +
    "やりとりを自然に練習させてください。丁寧で分かりやすい話し方を心がけます。" +
    JA_ENDING,
};

// The setting and register for a scene at an international congress. How the
// coach follows up and handles the target phrases comes from the scenario's
// discussion mode in prompt.ts, so an edited frame keeps it. These frames
// leave out the presets' "recycle the phrases in your own turns": congress
// phrases are the learner's own lines, and a counterpart who says them back
// ("I don't remember the details") breaks the scene.
export const EN_CONGRESS_FRAME =
  "Run a relaxed, realistic conversation at an international actuarial congress. " +
  "Play the other person in the situation, as a peer: share your own views and " +
  "experience, and let the conversation follow what the learner says within the " +
  "situation. Keep the register professional but warm. Also, " +
  EN_CLOSING_CHECK;

// A congress reception is not travel, so a Japanese scene set there gets its
// own opening.
export const JA_CONGRESS_FRAME =
  "国際会議の懇親会で、日本人の参加者を演じてください。相手は日本語を勉強中の" +
  "海外からの参加者です。丁寧語（です・ます）で、ゆっくり分かりやすく話し、" +
  "名刺交換や簡単な自己紹介などのやりとりを自然に練習させてください。" +
  "発表の内容を細かく質問せず、相手が言えたことを受け止めて会話を広げてください。" +
  JA_CLOSING_CHECK;
