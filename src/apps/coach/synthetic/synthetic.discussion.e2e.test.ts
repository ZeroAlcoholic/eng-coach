// SYNTHETIC check of discussion mode: the real PracticeSession and Gemini Live
// transport run a real congress scene against a scripted learner who remembers
// only the gist and says so. Paid and opt-in:
//   SYNTH=1 npx vitest run src/apps/coach/synthetic/synthetic.discussion.e2e.test.ts
// What it can prove is「合成已驗證」: that, in this run, the live coach asked
// for the learner's view, asked no question that needs the talk's facts or
// figures, and never spoke the learner's target lines as its own. Recall questions are matched by wording, so the transcript is also
// written out for a reader to check.
//
// Cost is bounded in code: ≤ MAX_LINES learner lines, ≤ MAX_SESSION_MS on the
// socket, no judge call. The estimate is printed first, then the run proceeds.

import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LIVE_MODEL } from "../../../kernel/overrides";
import { DEFAULT_PROFILE, type TranscriptTurn } from "../../../kernel/types";
import { ICA2026_SCENARIOS } from "../defaultsIca2026";
import { OPENING_CUE, sessionInstruction, silenceNudges } from "../prompt";
import { defaultSessionDeps, PracticeSession } from "../session";
import { describeEstimate, diskStore, ensureLines, geminiTts, keyOf } from "./synthLines";
import { SyntheticLearnerAudio } from "./SyntheticLearnerAudio";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SYNTH === "1" && apiKey.length > 0;

const MAX_LINES = 8;
const MAX_SESSION_MS = 3 * 60 * 1000;
const FIRST_CUE_MS = 60_000;
const REPLY_MS = 45_000;
const OUTPUT_RATE = 24_000;

const SCENARIO = ICA2026_SCENARIOS.en.find((s) => s.id === "def-en-ica-governance-qa")!;

// The learner keeps to the gist and admits a gap at line 3 — the moment a
// quizzing coach would ask for the number again.
const LINES = [
  "Thanks for the question. It's something we thought about a lot.",
  "The basic idea is simple. The bigger the impact, the closer we look.",
  "Hmm, I don't remember the exact number, sorry. But most tools are low risk.",
  "Personally, I think the hard part is keeping it up to date.",
  "How does your company handle this?",
  "That's interesting. I can check the details and get back to you.",
  "Thank you. Let's talk more after the session.",
];

// A coach question that needs the talk's facts: asks for a count, a share, a
// figure, or what the learner remembers.
const RECALL =
  /\b(how many|what percentage|what share|what proportion|what (?:was|were|is|are) the (?:exact )?(?:number|figure|percentage|result|threshold)s?|do you remember|can you recall|remind (?:me|us) (?:of|what|how))\b/i;
// A coach question that asks for the learner's own view or experience,
// including how their side does things.
const OPINION =
  /\b(what do you think|what's your (?:view|take|opinion)|your (?:view|opinion|experience|thoughts)|how do you feel|in your experience|do you think|how about (?:you|in taiwan)|what about you|how (?:does|do) your (?:company|team|side)|how do you (?:handle|approach|see|manage|ensure)|do you (?:have|use) [^?]*\byour)\b/i;

// The coach saying one of the learner's target STATEMENTS as its own: the turn
// contains it but does not hand it over as a suggestion. Question phrases are
// left out — "How does your company handle this?" fits either side's mouth;
// a statement about the learner's own work or gaps fits only theirs.
const SUGGESTS = /\b(?:you (?:could|can|might)(?: \w+)? (?:say|try)|try saying|could you try)\b/i;
// Live transcripts use curly apostrophes and dashes; compare letters only.
const norm = (t: string) =>
  t.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
// Judged per sentence, so one suggestion does not excuse a line parroted
// elsewhere in the same turn.
function parroted(turn: string, phrases: string[]): string[] {
  const said = turn
    .split(/(?<=[.!?。！？])\s+/)
    .filter((sentence) => !SUGGESTS.test(sentence))
    .map(norm)
    .join(" | ");
  return phrases.filter((p) => !/[?？]\s*$/.test(p) && norm(p).length > 0 && said.includes(norm(p)));
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
  });
});

let lines: Map<string, ArrayBuffer>;

describe.skipIf(!enabled)("synthetic E2E — a congress scene stays a discussion (paid, opt-in)", () => {
  beforeAll(async () => {
    expect(SCENARIO?.mode).toBe("discussion");
    expect(LINES.length).toBeLessThanOrEqual(MAX_LINES);
    const store = diskStore();
    const missing: string[] = [];
    for (const t of LINES) if (!(await store.read(keyOf(t)))) missing.push(t);
    console.log(`估價：${describeEstimate(missing)}；Live ${DEFAULT_LIVE_MODEL} ≤ ${MAX_SESSION_MS / 60_000} 分鐘；judge 0 次`);
    lines = (await ensureLines(LINES, geminiTts(apiKey), store)).lines;
  }, 120_000);

  it(
    "the coach asks the learner's view and never quizzes them on the talk",
    async () => {
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
        systemInstruction: sessionInstruction({ scenario: SCENARIO, profile: DEFAULT_PROFILE, dueItems: [], weakObjectives: [] }),
        voiceName: "Puck",
        openingCue: OPENING_CUE,
        silenceNudges: silenceNudges("en"),
      });
      const live = () => session.currentPhase().kind === "live";
      let elapsedMs = 0;
      try {
        expect(session.currentPhase().kind).toBe("live");
        await waitFor(() => youCount >= 1 || !live(), FIRST_CUE_MS);
        for (const text of LINES) {
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

      const coachQs = transcript.filter((t) => t.who === "coach").flatMap((t) => questions(t.text));
      const recall = coachQs.filter((q) => RECALL.test(q));
      // The first coach turn is the out-of-role scene-setter, which may preview lines.
      const inRole = transcript.filter((t) => t.who === "coach").slice(1);
      const echoes = inRole.flatMap((t) => parroted(t.text, SCENARIO.targetPhrases));
      const opinion = coachQs.filter((q) => OPINION.test(q));
      const report = [
        `# 討論模式合成讀數（${new Date().toISOString()}）`,
        `- 情境：${SCENARIO.id}；模型：Live ${DEFAULT_LIVE_MODEL}`,
        `- 學習者句數：${sent}／上限 ${MAX_LINES}；socket 時間：${Math.round(elapsedMs / 1000)} 秒／上限 ${MAX_SESSION_MS / 1000} 秒`,
        `- 教練問句：${coachQs.length}；要求回想事實／數字：${recall.length}；詢問學習者看法：${opinion.length}`,
        ...recall.map((q) => `  - 回想題：${q.trim()}`),
        ...opinion.map((q) => `  - 看法題：${q.trim()}`),
        `- 教練把學習者目標句當自己台詞：${echoes.length}`,
        ...echoes.map((e) => `  - ${e}`),
        "",
        "## 逐字稿",
        ...transcript.map((t) => `- ${t.who}: ${t.text}`),
      ].join("\n");
      console.log(report);
      mkdirSync(".tmp", { recursive: true });
      writeFileSync(".tmp/synthetic-discussion.md", report, "utf8");

      expect(elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      expect(sent).toBeGreaterThanOrEqual(4);
      expect(recall).toEqual([]);
      expect(opinion.length).toBeGreaterThanOrEqual(1);
      expect(echoes).toEqual([]);
    },
    MAX_SESSION_MS + 120_000,
  );
});
