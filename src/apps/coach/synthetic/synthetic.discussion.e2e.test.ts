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
];

// A coach question that needs the talk's facts: asks for a count, a share, a
// figure, or what the learner remembers.
const RECALL =
  /\b(how many|what percentage|what share|what proportion|what (?:was|were|is|are) the (?:exact )?(?:number|figure|percentage|result|threshold)s?|do you remember|can you recall|remind (?:me|us) (?:of|what|how))\b/i;
// A coach question that asks for the learner's own view or experience,
// including how their side does things.
const OPINION =
  /\b(what do you think|what's your (?:view|take|opinion)|your (?:\w+ )?(?:views?|opinion|experience|thoughts|concerns?|take)|what are your|how do you feel|in your experience|do you think|how about (?:you|in taiwan)|what about you|how (?:does|do) your (?:company|team|side|clients|customers|colleagues)|how do you (?:handle|approach|see|manage|ensure)|do you (?:have|use) [^?]*\byour|what do you (?:usually|like to) do|do you (?:usually|like|enjoy|prefer)|what kind of [^?]*\byou\b|would you say)\b|你覺得|你認為|你的看法|看法嗎/i;

// The coach saying one of the learner's target STATEMENTS as its own: the turn
// contains it but neither hands it over (a suggestion, a repeat request, the
// closing review) nor recasts what the learner has just said — a recast is the
// B1 correction the prompt asks for. Question phrases are left out — "How does
// your company handle this?" fits either side's mouth; a statement about the
// learner's own work or gaps fits only theirs.
const SUGGESTS =
  /\b(?:you (?:could|can|might)(?: \w+)? (?:say|try)|try saying|could you try|repeat|say (?:it|that) (?:again|back)|quick check|review that line)\b/i;
// The learner just said (most of) this phrase: the coach echoing it is a recast.
function justSaid(phrase: string, previousUser: string): boolean {
  const want = norm(phrase).split(" ");
  const heard = new Set(norm(previousUser).split(" "));
  return want.filter((w) => heard.has(w)).length / want.length >= 0.6;
}
// Live transcripts use curly apostrophes and dashes; compare letters only.
const norm = (t: string) =>
  t.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
// Judged per sentence, so one suggestion does not excuse a line parroted
// elsewhere in the same turn.
function parroted(turn: string, phrases: string[], previousUser = ""): string[] {
  const said = turn
    .split(/(?<=[.!?。！？])\s+/)
    .filter((sentence) => !SUGGESTS.test(sentence))
    .map(norm)
    .join(" | ");
  return phrases.filter(
    (p) => !/[?？]\s*$/.test(p) && norm(p).length > 0 && said.includes(norm(p)) && !justSaid(p, previousUser),
  );
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
    expect(OPINION.test("How many tools were high risk?")).toBe(false);
    expect(RECALL.test("How do you ensure the high risk ones are properly monitored?")).toBe(false);
  });

  it("parroted catches the counterpart saying a learner line and passes a suggestion", () => {
    const p = ["I don't remember the exact details, but I can check and get back to you."];
    expect(parroted("Sure. I don't remember the exact details, but I can check and get back to you.", p)).toEqual(p);
    expect(parroted("Sure. I don’t remember the exact details — but I can check and get back to you!", p)).toEqual(p);
    expect(parroted(`You could say: "I don't remember the exact details, but I can check and get back to you."`, p)).toEqual([]);
    expect(parroted("We review every tool once a year.", p)).toEqual([]);
    expect(parroted("You could charmingly say: I don't remember the exact details, but I can check and get back to you.", p)).toEqual([]);
    const two = ["Most of our tools are low risk.", "I don't remember the exact details."];
    expect(parroted("You could say: Most of our tools are low risk. And honestly, I don't remember the exact details.", two)).toEqual([two[1]]);
    expect(parroted("Interesting. How does your company handle this?", ["How does your company handle this?"])).toEqual([]);
    // A recast of what the learner has just said passes; the same line before they said it does not.
    const line = ["Before, agents spent a lot of time looking for materials."];
    const learner = "Before agents spent a lot of time looking for materials.";
    expect(parroted("Right, before, agents spent a lot of time looking for materials. And now?", line, learner)).toEqual([]);
    expect(parroted("Right, before, agents spent a lot of time looking for materials. And now?", line, "Sure, happy to.")).toEqual(line);
    expect(parroted(`Let's have you repeat that one line: "${line[0]}"`, line)).toEqual([]);
  });

  it("every script names a shipped discussion scene and fits the line cap", () => {
    for (const s of SCRIPTS) {
      expect(ICA2026_SCENARIOS.en.find((x) => x.id === s.id)?.mode, s.id).toBe("discussion");
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
    silenceNudges: silenceNudges("en"),
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
      `${script.id}: asks the learner's view, keeps to its own lines and Taiwan usage${script.aboutTalk ? ", never quizzes on the talk" : ""}`,
      async () => {
        const scenario = ICA2026_SCENARIOS.en.find((s) => s.id === script.id)!;
        const { transcript, sent, elapsedMs } = await runScene(scenario, script, lines);

        const coach = transcript.filter((t) => t.who === "coach");
        const coachQs = coach.flatMap((t) => questions(t.text));
        const recall = script.aboutTalk ? coachQs.filter((q) => RECALL.test(q)) : [];
        const opinion = coachQs.filter((q) => OPINION.test(q));
        // The first coach turn is the out-of-role scene-setter, which may preview lines.
        const firstCoach = transcript.findIndex((t) => t.who === "coach");
        const echoes = transcript.flatMap((t, i) => {
          if (t.who !== "coach" || i === firstCoach) return [];
          const previousUser = transcript.slice(0, i).reverse().find((u) => u.who === "user")?.text ?? "";
          return parroted(t.text, scenario.targetPhrases, previousUser);
        });
        const zh = coach.map((t) => zhTwProblem(t.text)).filter((p): p is string => p !== null);
        const stray = coach.flatMap((t) => strayScript(t.text));
        const report = [
          `# 討論模式合成讀數（${new Date().toISOString()}）`,
          `- 情境：${scenario.id}；模型：Live ${DEFAULT_LIVE_MODEL}`,
          `- 學習者句數：${sent}／上限 ${MAX_LINES}；socket 時間：${Math.round(elapsedMs / 1000)} 秒／上限 ${MAX_SESSION_MS / 1000} 秒`,
          `- 教練問句：${coachQs.length}；要求回想事實／數字：${script.aboutTalk ? recall.length : "（非報告情境，不判）"}；詢問學習者看法：${opinion.length}`,
          ...recall.map((q) => `  - 回想題：${q.trim()}`),
          ...opinion.map((q) => `  - 看法題：${q.trim()}`),
          `- 教練把學習者目標句當自己台詞：${echoes.length}`,
          ...echoes.map((e) => `  - ${e}`),
          `- 教練中文的台灣用語問題：${zh.length}`,
          ...zh.map((p) => `  - ${p}`),
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
        expect(opinion.length).toBeGreaterThanOrEqual(1);
        expect(echoes).toEqual([]);
        expect(zh).toEqual([]);
        expect(stray).toEqual([]);
      },
      MAX_SESSION_MS + 120_000,
    );
  }
});
