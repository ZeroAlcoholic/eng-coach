// SYNTHETIC check of discussion mode: the real PracticeSession and Gemini Live
// transport run real congress scenes against a scripted learner who remembers
// only the gist and says so. Paid and opt-in; one scene or all of them:
//   SYNTH=1 npx vitest run src/apps/coach/synthetic/synthetic.discussion.e2e.test.ts
//   SYNTH=1 npx vitest run src/apps/coach/synthetic/synthetic.discussion.e2e.test.ts -t def-en-ica-iaj-docai
// What it can prove is「合成已驗證」: that, in that run, the live coach asked
// for the learner's view, never spoke the learner's target lines as its own,
// kept its Chinese to Taiwan usage, and — in a scene about the team's talk —
// asked no question that needs the talk's facts or figures. Questions are
// matched by wording, so each transcript is also written out for a reader.
//
// Cost is bounded in code: ≤ MAX_LINES learner lines per scene, ≤
// MAX_SESSION_MS on the socket per scene, no judge call. The estimate is
// printed first, then the run proceeds.

import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LIVE_MODEL } from "../../../kernel/overrides";
import { DEFAULT_PROFILE, type Scenario, type TranscriptTurn } from "../../../kernel/types";
import { zhTwProblem } from "../../../kernel/zhTw";
import { ICA2026_SCENARIOS } from "../defaultsIca2026";
import { OPENING_CUE, sessionInstruction, silenceNudges } from "../prompt";
import { defaultSessionDeps, PracticeSession } from "../session";
import { describeEstimate, diskStore, ensureLines, geminiTts, keyOf } from "./synthLines";
import { parroted } from "./echo";
import { strayScript } from "./strayScript";
import { SyntheticLearnerAudio } from "./SyntheticLearnerAudio";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SYNTH === "1" && apiKey.length > 0;

const MAX_LINES = 8;
const MAX_SESSION_MS = 3 * 60 * 1000;
const FIRST_CUE_MS = 60_000;
const REPLY_MS = 45_000;
const OUTPUT_RATE = 24_000;

interface Script {
  id: string;
  // A scene about the team's own talk, where a recall question would be a quiz.
  aboutTalk: boolean;
  // Each script keeps to the gist and admits one gap — the moment a quizzing
  // coach would ask for the detail again.
  lines: string[];
}

const SCRIPTS: Script[] = [
  {
    id: "def-en-ica-governance-qa",
    aboutTalk: true,
    lines: [
      "Thanks for the question. It's something we thought about a lot.",
      "The basic idea is simple. The bigger the impact, the closer we look.",
      "Hmm, I don't remember the exact number, sorry. But most tools are low risk.",
      "For us, the hard part is keeping it up to date.",
      "How does your company handle this?",
      "That's interesting. I can check the details and get back to you.",
      "Thank you. Let's talk more after the session.",
    ],
  },
  {
    id: "def-en-ica-iaj-docai",
    aboutTalk: true,
    lines: [
      "Thank you for inviting me. It's nice to talk outside the sessions.",
      "The main idea is that sensitive data stays inside the company.",
      "I'm not sure about all the technical details, but we hide personal data first.",
      "In Taiwan, the rules on medical data are quite strict. How about in Japan?",
      "When you say it might be difficult, what is the main concern?",
      "I see. Maybe we could keep in touch after the Congress.",
      "Thank you very much. It was a pleasure.",
    ],
  },
  {
    id: "def-en-ica-press-interview",
    aboutTalk: true,
    lines: [
      "Sure, happy to. Simply put, it helps agents see a client's whole coverage.",
      "Before, agents spent a lot of time looking for materials.",
      "Not quite. The AI prepares the notes, and the agent has the conversation.",
      "I don't have the exact numbers with me, sorry. But it saves a lot of time.",
      "For our agents, the human part of the job matters even more now.",
      "In one line: less time searching, better conversations.",
      "Thank you for having me.",
    ],
  },
  {
    id: "def-en-ica-gala-dinner",
    aboutTalk: false,
    lines: [
      "This looks delicious. Have you tried this dish before?",
      "If I have a free afternoon tomorrow, where should I go?",
      "Sorry, could you say the name of that place again?",
      "On weekends, I usually go hiking near Taipei.",
      "What do you like to do on weekends in Tokyo?",
      "It's been really nice talking to you.",
      "I'm afraid I have to go. My colleagues are waiting for the shuttle.",
    ],
  },
  {
    id: "def-ja-ica-iaj-chat",
    aboutTalk: false,
    lines: [
      "はじめまして。リンです。台湾から来ました。",
      "よろしくお願いします。",
      "東京は楽しいです。",
      "すみません、日本語は少しだけです。",
      "英語で話してもいいですか。",
      "ありがとうございます。",
    ],
  },
];

// Stock praise, counted for the report only: the manner block asks for praise
// of the specific thing the learner did, so a falling count is the reading.
const STOCK_PRAISE = /\b(?:great job|good job|well done|fantastic|perfect|excellent|wonderful|amazing|brilliant)\b/gi;

const sceneOf = (id: string): Scenario | undefined => [...ICA2026_SCENARIOS.en, ...ICA2026_SCENARIOS.ja].find((s) => s.id === id);

// A coach question that needs the talk's facts: asks for a count, a share, a
// figure, or what the learner remembers.
const RECALL =
  /\b(how many|what percentage|what share|what proportion|what (?:was|were|is|are) the (?:exact )?(?:number|figure|percentage|result|threshold)s?|do you remember|can you recall|remind (?:me|us) (?:of|what|how))\b/i;
// A coach question that asks for the learner's own view or experience,
// including how their side does things.
const OPINION =
  /\b(what do you think|what's your (?:view|take|opinion)|your (?:\w+ )?(?:views?|opinion|experience|thoughts|concerns?|take|perspective)|what are your|how do you feel|in your experience|do you think|how about (?:you|in taiwan)|what about you|how (?:does|do) your (?:company|team|side|clients|customers|colleagues)|how do you (?:actually |usually )?(?:handle|approach|see|manage|ensure|decide)|do you (?:have|use) [^?]*\byour|do you have a favou?rite|what do you (?:usually|like to) do|do you (?:also |ever |really )?(?:usually|like|enjoy|prefer)|do you (?:\w+ )?(?:face|encounter|run into)|what kind of [^?]*\byou\b|would you say)\b|你覺得|你認為|你的看法|看法嗎/i;

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
const questions = (text: string) => text.split(/(?<=[?？])/).filter((q) => /[?？]\s*$/.test(q));

describe("discussion-mode matchers", () => {
  it("RECALL catches a quiz on the talk and passes a question about the learner's view", () => {
    expect(RECALL.test("How many of those tools were high risk?")).toBe(true);
    expect(RECALL.test("Do you remember what the threshold was?")).toBe(true);
    expect(RECALL.test("What do you think is the hardest part?")).toBe(false);
    expect(OPINION.test("What do you think is the hardest part?")).toBe(true);
    expect(OPINION.test("How does your team handle this?")).toBe(true);
    expect(OPINION.test("How do you ensure the high risk ones are properly monitored?")).toBe(true);
    expect(OPINION.test("Do you have regular reviews for your AI classifications?")).toBe(true);
    expect(OPINION.test("What do you usually do on weekends?")).toBe(true);
    expect(OPINION.test("What are your main concerns regarding compliance in Taiwan?")).toBe(true);
    expect(OPINION.test("How do your clients feel about this in Taiwan?")).toBe(true);
    expect(OPINION.test("How does your personal view on this differ from others?")).toBe(true);
    expect(OPINION.test("你可以分享你覺得科技如何突顯人性價值的看法嗎？")).toBe(true);
    expect(OPINION.test("Is your talk tomorrow?")).toBe(false);
    expect(OPINION.test("Could you explain how the model was trained?")).toBe(false);
    expect(OPINION.test("Do you have any questions?")).toBe(false);
    // Questions about the learner's own habits, likes and side's experience.
    expect(OPINION.test("Do you also enjoy exploring local food spots on your weekends?")).toBe(true);
    expect(OPINION.test("Do you have a favorite trail you always visit?")).toBe(true);
    expect(OPINION.test("When you do find high-risk tools, do you encounter any pushback from the business teams?")).toBe(true);
    expect(OPINION.test("Do you face similar oversight challenges in Taiwan?")).toBe(true);
    expect(OPINION.test("How do you actually decide the risk level for each AI tool?")).toBe(true);
    expect(OPINION.test("Do you also have the slides?")).toBe(false);
    expect(OPINION.test("Can you repeat that?")).toBe(false);
    expect(OPINION.test("How do you spell that?")).toBe(false);
    expect(OPINION.test("From your perspective, how does this shift the agent's role?")).toBe(true);
    expect(OPINION.test("Could you put that in perspective for our readers?")).toBe(false);
    expect(OPINION.test("How many tools were high risk?")).toBe(false);
    expect(RECALL.test("How do you ensure the high risk ones are properly monitored?")).toBe(false);
  });

  it("every script names a shipped discussion scene and fits the line cap", () => {
    for (const s of SCRIPTS) {
      expect(sceneOf(s.id)?.mode, s.id).toBe("discussion");
      expect(s.lines.length, s.id).toBeLessThanOrEqual(MAX_LINES);
    }
  });
});

async function runScene(scenario: Scenario, script: Script, lines: Map<string, ArrayBuffer>) {
  const transcript: TranscriptTurn[] = [];
  let audio: SyntheticLearnerAudio | null = null;
  let youCount = 0;
  let sent = 0;
  const startedAt = Date.now();
  const session = new PracticeSession(
    {
      createTransport: (spec, handlers) => defaultSessionDeps.createTransport(spec, handlers),
      createAudio: (cb) => (audio = new SyntheticLearnerAudio(cb, OUTPUT_RATE, undefined, true)),
    },
    {
      onPhase: () => {},
      onCue: (t) => {
        if (t === "you") youCount++;
      },
      onTranscript: (who, text) => mergeDelta(transcript, who, text),
      onCoachClip: () => {},
      onNotice: (n) => console.log("notice:", n),
      onAutoStop: () => {},
    },
  );
  const deadline = startedAt + MAX_SESSION_MS - 15_000;
  await session.start({
    apiKey,
    model: DEFAULT_LIVE_MODEL,
    systemInstruction: sessionInstruction({ scenario, profile: DEFAULT_PROFILE, dueItems: [], weakObjectives: [] }),
    voiceName: "Puck",
    openingCue: OPENING_CUE,
    silenceNudges: silenceNudges(scenario.targetLanguage),
  });
  const live = () => session.currentPhase().kind === "live";
  let elapsedMs = 0;
  try {
    expect(session.currentPhase().kind).toBe("live");
    await waitFor(() => youCount >= 1 || !live(), FIRST_CUE_MS);
    for (const text of script.lines) {
      if (!live() || Date.now() > deadline) break;
      const before = youCount;
      await audio!.say(lines.get(text)!);
      sent++;
      await waitFor(() => youCount > before || !live(), REPLY_MS);
    }
  } finally {
    await session.stop();
    elapsedMs = Date.now() - startedAt;
  }
  return { transcript, sent, elapsedMs };
}

let lines: Map<string, ArrayBuffer>;

describe.skipIf(!enabled)("synthetic E2E — congress scenes stay discussions (paid, opt-in)", () => {
  beforeAll(async () => {
    const all = [...new Set(SCRIPTS.flatMap((s) => s.lines))];
    const store = diskStore();
    const missing: string[] = [];
    for (const t of all) if (!(await store.read(keyOf(t)))) missing.push(t);
    console.log(
      `估價：${describeEstimate(missing)}；Live ${DEFAULT_LIVE_MODEL} 每個情境 ≤ ${MAX_SESSION_MS / 60_000} 分鐘（共 ${SCRIPTS.length} 個，可用 -t 只跑一個）；judge 0 次`,
    );
    lines = (await ensureLines(all, geminiTts(apiKey), store)).lines;
  }, 180_000);

  for (const script of SCRIPTS) {
    it(
      `${script.id}: ${sceneOf(script.id)?.targetLanguage === "ja" ? "keeps to Taiwan usage" : "asks the learner's view, keeps to its own lines and Taiwan usage"}${script.aboutTalk ? ", never quizzes on the talk" : ""}`,
      async () => {
        const scenario = sceneOf(script.id)!;
        // The Japanese coach teaches each line before it asks for it, and a
        // greeting has no view to ask about: neither check means anything there.
        const english = scenario.targetLanguage === "en";
        const { transcript, sent, elapsedMs } = await runScene(scenario, script, lines);

        const coach = transcript.filter((t) => t.who === "coach");
        const coachQs = coach.flatMap((t) => questions(t.text));
        const recall = script.aboutTalk ? coachQs.filter((q) => RECALL.test(q)) : [];
        const opinion = english ? coachQs.filter((q) => OPINION.test(q)) : [];
        // The first coach turn is the out-of-role scene-setter, which may preview lines.
        const firstCoach = transcript.findIndex((t) => t.who === "coach");
        const echoes = transcript.flatMap((t, i) => {
          if (!english || t.who !== "coach" || i === firstCoach) return [];
          const previousUser = transcript.slice(0, i).reverse().find((u) => u.who === "user")?.text ?? "";
          return parroted(t.text, scenario.targetPhrases, previousUser);
        });
        const zh = coach.map((t) => zhTwProblem(t.text)).filter((p): p is string => p !== null);
        const stray = coach.flatMap((t) => strayScript(t.text));
        const praise = coach.flatMap((t) => t.text.match(STOCK_PRAISE) ?? []);
        const report = [
          `# 討論模式合成讀數（${new Date().toISOString()}）`,
          `- 情境：${scenario.id}；模型：Live ${DEFAULT_LIVE_MODEL}`,
          `- 學習者句數：${sent}／上限 ${MAX_LINES}；socket 時間：${Math.round(elapsedMs / 1000)} 秒／上限 ${MAX_SESSION_MS / 1000} 秒`,
          `- 教練問句：${coachQs.length}；要求回想事實／數字：${script.aboutTalk ? recall.length : "（非報告情境，不判）"}；詢問學習者看法：${english ? opinion.length : "（日語寒暄，不判）"}`,
          ...recall.map((q) => `  - 回想題：${q.trim()}`),
          ...opinion.map((q) => `  - 看法題：${q.trim()}`),
          `- 教練把學習者目標句當自己台詞：${english ? echoes.length : "（日語逐句教，不判）"}`,
          ...echoes.map((e) => `  - ${e}`),
          `- 教練中文的台灣用語問題：${zh.length}`,
          ...zh.map((p) => `  - ${p}`),
          `- 教練套話式稱讚（只記錄）：${praise.length}／教練發言 ${coach.length} 次`,
          `- 教練輸出夾雜他國文字：${stray.length}`,
          ...stray.map((w) => `  - ${w}`),
          "",
          "## 逐字稿",
          ...transcript.map((t) => `- ${t.who}: ${t.text}`),
        ].join("\n");
        console.log(report);
        mkdirSync(".tmp", { recursive: true });
        writeFileSync(`.tmp/synthetic-discussion-${scenario.id}.md`, report, "utf8");

        expect(elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
        expect(sent).toBeGreaterThanOrEqual(4);
        expect(recall).toEqual([]);
        if (english) expect(opinion.length).toBeGreaterThanOrEqual(1);
        expect(echoes).toEqual([]);
        expect(zh).toEqual([]);
        expect(stray).toEqual([]);
      },
      MAX_SESSION_MS + 120_000,
    );
  }
});
