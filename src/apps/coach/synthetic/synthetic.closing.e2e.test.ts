// C2 — SYNTHETIC check of the closing: the real PracticeSession, the real Gemini
// Live transport and the real judge, a scripted learner, ONE script. Paid and
// opt-in:
//   SYNTH=1 npx vitest run src/apps/coach/synthetic/synthetic.closing.e2e.test.ts
// What it can prove is「合成已驗證」: that the live model ends with the closing
// line, that the owner then sends no nudge and ends the session itself, and
// that the judge still reviews it. Nothing about a phone or a person.
//
// Cost is bounded in code: ≤ MAX_LINES learner lines, ≤ MAX_SESSION_MS on the
// socket, one judge call. The estimate is printed first, then the run proceeds.

import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LIVE_MODEL, DEFAULT_TEXT_MODEL } from "../../../kernel/overrides";
import { DEFAULT_PROFILE, type Scenario, type TranscriptTurn } from "../../../kernel/types";
import { summariseSession } from "../ai";
import { saysClosingLine } from "../closing";
import { FRAME_PRESETS } from "../frames";
import { CLOSING_LINE, OPENING_CUE, sessionInstruction, silenceNudges } from "../prompt";
import { AUTO_STOP_MS, defaultSessionDeps, PracticeSession } from "../session";
import { describeEstimate, diskStore, ensureLines, geminiTts, keyOf } from "./synthLines";
import { SyntheticLearnerAudio } from "./SyntheticLearnerAudio";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SYNTH === "1" && apiKey.length > 0;

const MAX_LINES = 12;
const MAX_SESSION_MS = 4 * 60 * 1000;
const FIRST_CUE_MS = 60_000;
const REPLY_MS = 45_000;
const OUTPUT_RATE = 24_000;

// Two small objectives the script completes early, so the coach reaches its
// Closing order well inside the cap; then the learner goes quiet.
const SCENARIO: Scenario = {
  id: "synthetic-closing-hotel",
  title: "飯店報到",
  targetLanguage: "en",
  level: "A2",
  baseContext: FRAME_PRESETS.en,
  contentContext:
    "倫敦一家小飯店的櫃台，晚上九點。櫃台人員 Anna Brown 正在等你報到。你訂了兩晚，想確認早餐時間。今晚櫃台只剩她一個人，後面還有客人在排隊。",
  coachRole: "Anna Brown，飯店櫃台人員，親切、講話清楚",
  userRole: "剛抵達倫敦、要辦入住的台灣旅客",
  objectives: ["用訂房姓名辦理入住", "問早餐幾點開始"],
  targetPhrases: ["I have a reservation under ...", "What time is breakfast?"],
};

const LINES = [
  "Hi, good evening. I have a reservation under Chen.",
  "Yes, two nights, please.",
  "Here is my passport.",
  "What time is breakfast?",
  "Great, thank you. That's all I need for today.",
  "Thank you very much. Good night.",
];

interface Reading {
  transcript: TranscriptTurn[];
  closingAt: number | null; // ms since start when the owner entered closing
  nudgesAfterClose: number;
  autoStopped: boolean;
  elapsedMs: number;
  sent: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await sleep(100);
  }
  return pred();
}
function mergeDelta(turns: TranscriptTurn[], who: TranscriptTurn["who"], text: string): void {
  const last = turns[turns.length - 1];
  if (last && last.who === who) turns[turns.length - 1] = { who, text: last.text + text };
  else turns.push({ who, text });
}

let lines: Map<string, ArrayBuffer>;

describe.skipIf(!enabled)("synthetic E2E — the coach's closing ends the session (C2, paid, opt-in)", () => {
  beforeAll(async () => {
    expect(LINES.length).toBeLessThanOrEqual(MAX_LINES);
    const store = diskStore();
    const missing: string[] = [];
    for (const t of LINES) if (!(await store.read(keyOf(t)))) missing.push(t);
    console.log(
      `估價：${describeEstimate(missing)}；Live ${DEFAULT_LIVE_MODEL} ≤ ${MAX_SESSION_MS / 60_000} 分鐘；judge ${DEFAULT_TEXT_MODEL} 1 次`,
    );
    lines = (await ensureLines(LINES, geminiTts(apiKey), store)).lines;
  }, 120_000);

  it(
    "closing line → zero nudges after it, the session ends itself, the judge reviews it",
    async () => {
      const r: Reading = { transcript: [], closingAt: null, nudgesAfterClose: 0, autoStopped: false, elapsedMs: 0, sent: 0 };
      let audio: SyntheticLearnerAudio | null = null;
      let youCount = 0;
      const startedAt = Date.now();
      const session = new PracticeSession(
        {
          createTransport: (spec, handlers) => {
            const t = defaultSessionDeps.createTransport(spec, handlers);
            const send = t.sendText.bind(t);
            t.sendText = (text) => {
              if (r.closingAt !== null) r.nudgesAfterClose++;
              return send(text);
            };
            return t;
          },
          createAudio: (cb) => (audio = new SyntheticLearnerAudio(cb, OUTPUT_RATE, undefined, true)),
        },
        {
          onPhase: (p) => {
            if (p.kind === "live" && p.closing && r.closingAt === null) r.closingAt = Date.now() - startedAt;
          },
          onCue: (t) => {
            if (t === "you") youCount++;
          },
          onTranscript: (who, text) => mergeDelta(r.transcript, who, text),
          onCoachClip: () => {},
          onNotice: (n) => console.log("notice:", n),
          onAutoStop: () => {
            r.autoStopped = true;
          },
        },
      );
      const deadline = startedAt + MAX_SESSION_MS - 15_000;
      await session.start({
        apiKey,
        model: DEFAULT_LIVE_MODEL,
        systemInstruction: sessionInstruction({ scenario: SCENARIO, profile: DEFAULT_PROFILE, dueItems: [], weakObjectives: [] }),
        voiceName: "Puck",
        openingCue: OPENING_CUE,
        silenceNudges: silenceNudges("en"),
      });
      const live = () => session.currentPhase().kind === "live";
      try {
        expect(session.currentPhase().kind).toBe("live");
        await waitFor(() => youCount >= 1 || !live(), FIRST_CUE_MS);
        for (const text of LINES) {
          if (!live() || r.closingAt !== null || Date.now() > deadline) break;
          const before = youCount;
          await audio!.say(lines.get(text)!);
          r.sent++;
          await waitFor(() => youCount > before || !live(), REPLY_MS);
        }
        // The learner is done: stay silent. The coach should close (nudges may
        // prompt it), and the owner should then ask to stop by itself.
        await waitFor(() => r.autoStopped || !live() || Date.now() > deadline, Math.max(0, deadline - Date.now()));
      } finally {
        await session.stop();
        r.elapsedMs = Date.now() - startedAt;
      }

      const coachTurns = r.transcript.filter((t) => t.who === "coach");
      const lastCoach = coachTurns.at(-1)?.text ?? "";
      const judged = await summariseSession(apiKey, { transcript: r.transcript, level: SCENARIO.level, objectives: SCENARIO.objectives });

      const report = [
        `# C2 合成讀數（${new Date().toISOString()}）`,
        `- 模型：Live ${DEFAULT_LIVE_MODEL}；judge ${DEFAULT_TEXT_MODEL}`,
        `- 學習者句數：${r.sent}／上限 ${MAX_LINES}；socket 時間：${Math.round(r.elapsedMs / 1000)} 秒／上限 ${MAX_SESSION_MS / 1000} 秒`,
        `- 進入收場：${r.closingAt === null ? "否" : `是（第 ${Math.round(r.closingAt / 1000)} 秒）`}`,
        `- 收場後送出的靜默指示：${r.nudgesAfterClose}`,
        `- 自動結束（收尾播完後 ${AUTO_STOP_MS / 1000} 秒無人開口）：${r.autoStopped ? "是" : "否"}`,
        `- 教練最後一個 turn 含「${CLOSING_LINE}」：${saysClosingLine(lastCoach) ? "是" : "否"}`,
        `- 教練最後一個 turn：${lastCoach.slice(-200)}`,
        `- judge：${judged.kind === "review" ? `review（CEFR ${judged.review.cefr}）` : `unavailable：${judged.reason}`}`,
        "",
        "## 逐字稿",
        ...r.transcript.map((t) => `- ${t.who}: ${t.text}`),
      ].join("\n");
      console.log(report);
      mkdirSync(".tmp", { recursive: true });
      writeFileSync(".tmp/synthetic-closing.md", report, "utf8");

      expect(r.elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      expect(r.closingAt).not.toBeNull();
      expect(r.nudgesAfterClose).toBe(0);
      expect(r.autoStopped).toBe(true);
      expect(saysClosingLine(lastCoach)).toBe(true);
      expect(judged.kind).toBe("review");
    },
    MAX_SESSION_MS + 120_000,
  );
});
