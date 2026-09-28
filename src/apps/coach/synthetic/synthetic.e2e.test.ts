// F3 — SYNTHETIC end-to-end: the real PracticeSession, the real Gemini Live
// transport and the real judge, with a scripted learner in place of the phone.
// Paid and opt-in, like the judge screening:
//   SYNTH=1 npx vitest run src/apps/coach/synthetic/synthetic.e2e.test.ts
//   SYNTH=1 SYNTH_GOAWAY=1 npx vitest run ... (the 12-minute hand-over check, alone)
// Vocabulary for anything this proves:「合成已驗證」— the protocol, the
// lifecycle and the pipeline hold on real audio. It says nothing about a
// phone, a microphone permission or how the coaching feels to a person.
//
// Cost is bounded in code, not by restraint: every script is ≤ MAX_LINES
// lines and ≤ MAX_SESSION_MS on the socket; the hand-over check ≤ GOAWAY_MAX_MS.
// The estimate is printed first, then the run proceeds.

import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LIVE_MODEL, DEFAULT_TEXT_MODEL } from "../../../kernel/overrides";
import { DEFAULT_PROFILE, type LearnedItem, type LearnerProfile, type Scenario, type SessionRecord, type TranscriptTurn } from "../../../kernel/types";
import { extractLearnedItems, summariseSession } from "../ai";
import { ANNOTATION_FIXTURES, FIXTURES, type JudgeFixture } from "../ai/fixtures/transcripts";
import { annotateTurns } from "../annotate";
import { finalizeSession, type FinalizeDeps } from "../finalize";
import { microInstruction } from "../focus";
import { cefrToNum } from "../progress";
import { sessionInstruction, type ArcContext } from "../prompt";
import { defaultSessionDeps, PracticeSession, type SessionPhase } from "../session";
import { describeEstimate, diskStore, ensureLines, geminiTts, keyOf, type SynthResult } from "./synthLines";
import { SyntheticLearnerAudio } from "./SyntheticLearnerAudio";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SYNTH === "1" && apiKey.length > 0;
const goAwayEnabled = enabled && process.env.SYNTH_GOAWAY === "1";

const MAX_LINES = 12;
const MAX_SESSION_MS = 4 * 60 * 1000;
const GOAWAY_MAX_MS = 13 * 60 * 1000;
const GOAWAY_LOOP_MS = 12 * 60 * 1000;
const FIRST_CUE_MS = 60_000; // the coach's greeting must have finished playing by then
const REPLY_MS = 45_000; // one coach reply after one learner line
const OUTPUT_RATE = 24_000;

// --- the scripts -----------------------------------------------------------

const hotel = FIXTURES.find((f) => f.id === "en-a2-hotel")!;
const enMixed = ANNOTATION_FIXTURES.find((f) => f.id === "en-mixed")!;
const jaMixed = ANNOTATION_FIXTURES.find((f) => f.id === "ja-mixed")!;
const learnerLines = (f: JudgeFixture) => f.transcript.filter((t) => t.who === "user").map((t) => t.text);

const HELP_LINE = "提示一下";
const AFTER_HELP_LINE = "I would like a table by the window, please.";
const ECHO_REQUEST = "Please say this sentence once for me: I would like a table by the window.";
const MICRO_LINES = ["Yesterday I go to the office.", "Yesterday I went to the office and I finish the report.", "Last week I visited the client."];

const SCRIPTED = [
  ...learnerLines(hotel),
  ...learnerLines(enMixed),
  ...learnerLines(jaMixed),
  HELP_LINE,
  AFTER_HELP_LINE,
  ECHO_REQUEST,
  ...MICRO_LINES,
  "Hello, I have just arrived.",
];

// --- harness -----------------------------------------------------------------

function scenarioFor(f: JudgeFixture): Scenario {
  return {
    id: `synthetic-${f.id}`,
    title: f.id,
    targetLanguage: f.language,
    level: f.level,
    baseContext: f.language === "ja" ? "旅行會話練習：你是店員，學習者是旅客。" : "Business/travel role-play. You are the counterpart; the learner is the customer.",
    contentContext: f.id.includes("hotel")
      ? "A hotel front desk in the morning. The learner is a guest."
      : f.id.includes("mixed") && f.language === "en"
        ? "Luigi's restaurant, taking a phone booking."
        : f.language === "ja"
          ? "レストラン花。電話で予約を受ける。"
          : "",
    coachRole: f.language === "ja" ? "店員" : "the receptionist",
    userRole: f.language === "ja" ? "旅客" : "the customer",
    objectives: f.objectives,
    targetPhrases: [],
  };
}

interface Run {
  transcript: TranscriptTurn[];
  cuesYouWhilePlaying: number; // F3-a: how many times「換你說」fired with audio still playing
  cueChanges: number;
  phases: SessionPhase[];
  reconnectingSeen: boolean;
  resumedWithMemory: boolean | null;
  elapsedMs: number;
  sent: number;
}

interface Script {
  scenario: Scenario;
  profile?: LearnerProfile;
  lines: string[]; // spoken in order, each after the coach's turn has drained
  micro?: string;
  arc?: ArcContext;
  dynamicEcho?: boolean; // after line 0's reply, say the coach's last line back (F3-c)
  loopUntilMs?: number; // F3-g: keep cycling the lines until this long has passed or a hand-over was seen
}

let lines: SynthResult["lines"];
const store = diskStore();
const results: string[] = [];
const record = (line: string) => {
  results.push(line);
  console.log(line);
};

function mergeDelta(turns: TranscriptTurn[], who: TranscriptTurn["who"], text: string): void {
  const last = turns[turns.length - 1];
  if (last && last.who === who) turns[turns.length - 1] = { who, text: last.text + text };
  else turns.push({ who, text });
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

async function runScript(script: Script): Promise<Run> {
  expect(script.lines.length).toBeLessThanOrEqual(MAX_LINES);
  const run: Run = { transcript: [], cuesYouWhilePlaying: 0, cueChanges: 0, phases: [], reconnectingSeen: false, resumedWithMemory: null, elapsedMs: 0, sent: 0 };
  let audio: SyntheticLearnerAudio | null = null;
  let youCount = 0;
  const notices: string[] = [];
  const session = new PracticeSession(
    {
      createTransport: defaultSessionDeps.createTransport,
      createAudio: (cb) => (audio = new SyntheticLearnerAudio(cb, OUTPUT_RATE, undefined, true)),
    },
    {
      onPhase: (p) => {
        run.phases.push(p);
        if (p.kind === "live" && p.reconnecting) run.reconnectingSeen = true;
        if (p.kind === "live" && !p.reconnecting && run.reconnectingSeen && run.resumedWithMemory === null) {
          run.resumedWithMemory = !notices.some((n) => n.includes("可能不記得"));
        }
      },
      onCue: (t) => {
        run.cueChanges++;
        if (t === "you") {
          youCount++;
          if (audio?.isPlaying()) run.cuesYouWhilePlaying++;
        }
      },
      onTranscript: (who, text) => mergeDelta(run.transcript, who, text),
      onCoachClip: () => {},
      onNotice: (n) => {
        notices.push(n);
        console.log("notice:", n);
      },
    },
  );
  const startedAt = Date.now();
  const deadline = startedAt + (script.loopUntilMs ?? MAX_SESSION_MS);
  const profile = script.profile ?? DEFAULT_PROFILE;
  await session.start({
    apiKey,
    model: DEFAULT_LIVE_MODEL,
    systemInstruction: sessionInstruction({
      scenario: script.scenario,
      profile,
      dueItems: [],
      weakObjectives: [],
      arc: script.arc,
      ...(script.micro !== undefined ? { micro: script.micro } : {}),
    }),
    voiceName: "Puck",
  });
  try {
    expect(session.currentPhase().kind).toBe("live");
    // A session that ends on its own (setup rejected, quota, drop) must fail
    // the check at once — never let the script talk to a dead socket.
    const alive = () => {
      const p = session.currentPhase();
      if (p.kind !== "live") throw new Error(`session is not live: ${JSON.stringify(p)}；notices=${notices.join(" / ")}`);
    };
    // the coach greets first; wait for that turn to finish playing
    const greeted = await waitFor(() => youCount >= 1 || session.currentPhase().kind !== "live", FIRST_CUE_MS);
    alive();
    if (!greeted) record(`- 教練 ${FIRST_CUE_MS / 1000} 秒內沒有開口（cue 未轉「you」），照樣送出第一句`);
    const speak = async (text: string) => {
      const pcm = lines.get(text);
      if (!pcm) throw new Error(`no synthesised audio for a scripted line (${keyOf(text).slice(0, 8)})`);
      alive();
      const before = youCount;
      await audio!.say(pcm); // rejects if the engine was stopped: the line is then not counted as sent
      run.sent++;
      const replied = await waitFor(() => youCount > before || session.currentPhase().kind !== "live", REPLY_MS);
      alive();
      if (!replied) record(`- 第 ${run.sent} 句之後 ${REPLY_MS / 1000} 秒內教練沒有回完（cue 未再轉「you」）`);
    };
    let i = 0;
    for (;;) {
      if (Date.now() > deadline - 20_000) break; // leave room to stop cleanly under the cap
      if (script.loopUntilMs && run.reconnectingSeen && run.resumedWithMemory !== null) break;
      if (i >= script.lines.length) {
        if (!script.loopUntilMs) break;
        i = 0;
      }
      await speak(script.lines[i]);
      if (script.dynamicEcho && i === 0) {
        const lastCoach = [...run.transcript].reverse().find((t) => t.who === "coach")?.text.trim();
        if (lastCoach) {
          const extra = await ensureLines([lastCoach], geminiTts(apiKey), store);
          lines.set(lastCoach, extra.lines.get(lastCoach)!);
          run.sent++;
          const before = youCount;
          await audio!.say(lines.get(lastCoach)!);
          await waitFor(() => youCount > before, REPLY_MS);
          expect(run.sent).toBeLessThanOrEqual(MAX_LINES);
        }
      }
      i++;
    }
  } finally {
    await session.stop();
    run.elapsedMs = Date.now() - startedAt;
  }
  return run;
}

function memoryDeps(seed: { profile?: LearnerProfile; items?: LearnedItem[] } = {}) {
  const sessions = new Map<string, SessionRecord>();
  let items: LearnedItem[] = [...(seed.items ?? [])];
  let profile: LearnerProfile = seed.profile ?? { ...DEFAULT_PROFILE };
  const deps: FinalizeDeps = {
    now: () => new Date().toISOString(),
    getSession: async (id) => sessions.get(id),
    updateSession: async (id, mutate) => {
      const next = mutate(sessions.get(id));
      if (next) sessions.set(id, next);
      return next;
    },
    clearDraft: async () => {},
    listItems: async () => items,
    putItems: async (xs) => {
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const x of xs) byId.set(x.id, x);
      items = [...byId.values()];
    },
    putScenario: async () => {},
    getProfile: async () => profile,
    putProfile: async (p) => {
      profile = p;
    },
    recordJudgeOutcomes: async () => {},
    extractItems: (input) => extractLearnedItems(apiKey, input),
    judge: (input) => summariseSession(apiKey, input),
    arc: { getArc: async () => undefined, markEpisodePlayed: async () => {}, advance: async () => {} },
  };
  return { deps, sessions, get profile() { return profile; }, get items() { return items; } };
}

const userTurns = (run: Run) => run.transcript.filter((t) => t.who === "user");
const verdict = (check: string, pass: boolean, measured: string) => {
  record(`| ${check} | **${pass ? "pass" : "fail"}** | ${measured} |`);
  return pass;
};

// --- the run -----------------------------------------------------------------

describe.skipIf(!enabled)("synthetic learner E2E — real Live model, scripted learner (paid, opt-in)", () => {
  beforeAll(async () => {
    const missing: string[] = [];
    for (const t of SCRIPTED) if (!(await store.read(keyOf(t)))) missing.push(t);
    const liveMinutes = goAwayEnabled ? 13 : 5 * 4;
    console.log(`估價：${describeEstimate(missing)}；Live ${DEFAULT_LIVE_MODEL} ≤ ${liveMinutes} 分鐘；judge ${DEFAULT_TEXT_MODEL} ≤ 5 次；items ≤ 5 次`);
    const out = await ensureLines(SCRIPTED, geminiTts(apiKey), store);
    lines = out.lines;
    record(`F2 合成台詞：${SCRIPTED.length} 句，本次新合成 ${out.synthesised} 句（其餘快取命中）`);
    // F2's own proof: a second pass over the same lines costs nothing.
    const again = await ensureLines(SCRIPTED, geminiTts(apiKey), store);
    expect(again.synthesised).toBe(0);
    record("| F2 重跑零呼叫 | **pass** | 第二次 ensureLines synthesised=0 |");
  }, 10 * 60 * 1000);

  afterAll(() => {
    mkdirSync(".synthetic-cache", { recursive: true });
    writeFileSync(".synthetic-cache/last-run.md", [`# synthetic run ${new Date().toISOString()}`, "", ...results, ""].join("\n"));
  });

  it.skipIf(goAwayEnabled)(
    "F3-a/b/h — hotel script: cue timing, transcript continuity, judge output",
    async () => {
      const run = await runScript({ scenario: scenarioFor(hotel), lines: learnerLines(hotel) });
      expect(run.elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      const n = learnerLines(hotel).length;
      const users = userTurns(run).length;
      const cueOk = verdict("F3-a 換你說時機", run.cueChanges > 0 && run.cuesYouWhilePlaying === 0, `cue→you ${run.cueChanges} 次，其中播放中 ${run.cuesYouWhilePlaying} 次`);
      const continuity = verdict("F3-b 逐字稿連續", users >= 0.8 * n, `送 ${n} 句 → user turn ${users} 個`);
      const m = memoryDeps();
      const out = await finalizeSession(apiKey, {
        scenario: scenarioFor(hotel),
        profile: DEFAULT_PROFILE,
        sessionId: "synthetic-hotel",
        startedAt: new Date().toISOString(),
        transcript: run.transcript,
        aids: { suggestions: 0, translations: 0 },
      }, m.deps);
      const rec = m.sessions.get("synthetic-hotel")!;
      const learnerText = rec.transcript.filter((t) => t.who === "user").map((t) => t.text.toLocaleLowerCase()).join("\n");
      const examplesOk = (rec.review?.errors ?? []).every((e) => learnerText.includes(e.example.toLocaleLowerCase().trim()));
      const band = rec.review ? Math.abs(cefrToNum(rec.review.cefr) - cefrToNum(hotel.expectBand!)) <= 1 : false;
      const hOk = verdict("F3-h 判斷輸出", out.kind === "done" && out.judge.kind === "review" && examplesOk && band, `judge=${out.kind === "done" ? out.judge.kind : out.kind}，cefr=${rec.review?.cefr ?? "—"}（期望 ${hotel.expectBand}±1），errors=${rec.review?.errors?.length ?? 0} 皆子字串=${examplesOk}，focus=${JSON.stringify(rec.focus ?? null)}`);
      record(`- U2 讀數：合成 hotel 逐字稿 CEFR=${rec.review?.cefr ?? "—"}，unaided can-do 判定 ${JSON.stringify(rec.review?.objectivesMet ?? [])}`);
      record(`- 逐字稿（learner）：${rec.transcript.filter((t) => t.who === "user").map((t) => t.text).join(" ‖ ")}`);
      expect(cueOk).toBe(true);
      expect(continuity).toBe(true);
      expect(hOk).toBe(true);
    },
    MAX_SESSION_MS + 60_000,
  );

  it.skipIf(goAwayEnabled)(
    "F3-c/d — echo and spoken help are annotated on real recogniser output",
    async () => {
      const sc = scenarioFor(hotel);
      const run = await runScript({ scenario: { ...sc, id: "synthetic-echo", objectives: ["ask for a table"] }, lines: [ECHO_REQUEST, HELP_LINE, AFTER_HELP_LINE], dynamicEcho: true });
      expect(run.elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      const annotated = annotateTurns(run.transcript, "en");
      const users = annotated.filter((t) => t.who === "user");
      record(`- 逐字稿（learner）：${users.map((t, i) => `[${i}${t.echo ? " echo" : ""}${t.aided ? " aided" : ""}${t.l1 ? " l1" : ""}] ${t.text}`).join(" ‖ ")}`);
      // the echo line is the coach's own words said back: it is the learner turn right after the request's reply
      const echoIdx = users.findIndex((t) => t.echo);
      const onlyOneEcho = users.filter((t) => t.echo).length === 1;
      verdict("F3-c 回聲偵測命中", echoIdx >= 0 && onlyOneEcho, `echo 標在 learner turn ${echoIdx}（共 ${users.filter((t) => t.echo).length} 個）`);
      record(`- U1 讀數：回聲門檻 0.8 於真實 ASR：${users.filter((t) => t.echo).length} 個標記／${users.length} 個 learner turn`);
      const helpIdx = users.findIndex((t) => /提示/.test(t.text));
      // the recogniser may run the request and the helped line into one turn;
      // either way the line spoken with help must carry `aided`
      const helped = helpIdx >= 0 ? users.slice(helpIdx).filter((t) => t.text.trim()).slice(0, 2) : [];
      const aidedNext = helped.length > 0 && helped.every((t) => t.aided === true);
      verdict("F3-d 口說求助", aidedNext, `求助 turn=${helpIdx}，該 turn 與其後 learner turn aided=${helped.map((t) => t.aided === true).join("/")}`);
      expect(echoIdx).toBeGreaterThanOrEqual(0);
      expect(aidedNext).toBe(true);
    },
    MAX_SESSION_MS + 60_000,
  );

  it.skipIf(goAwayEnabled)(
    "F3-e — a micro session finalises as micro: no review, no level",
    async () => {
      const sc = { ...scenarioFor(hotel), id: "synthetic-micro" };
      const micro = microInstruction({ kind: "meaning", type: "tense", example: "I go yesterday", correction: "I went yesterday" });
      const run = await runScript({ scenario: sc, lines: MICRO_LINES, micro });
      expect(run.elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      const m = memoryDeps();
      const out = await finalizeSession(apiKey, {
        scenario: sc,
        profile: DEFAULT_PROFILE,
        sessionId: "synthetic-micro-1",
        startedAt: new Date().toISOString(),
        transcript: run.transcript,
        aids: { suggestions: 0, translations: 0 },
        micro: { sourceSessionId: "synthetic-hotel" },
      }, m.deps);
      const rec = m.sessions.get("synthetic-micro-1")!;
      const eOk = verdict("F3-e 微 session 流程", out.kind === "micro" && !rec.review && m.profile.levels === undefined && rec.kind === "micro" && userTurns(run).length > 0 && run.transcript.some((t) => t.who === "coach"), `finalize=${out.kind}，review=${!!rec.review}，levels=${JSON.stringify(m.profile.levels ?? null)}，user turns=${userTurns(run).length}`);
      record(`- 教練首句：${run.transcript.find((t) => t.who === "coach")?.text.slice(0, 120) ?? "—"}`);
      expect(eOk).toBe(true);
    },
    MAX_SESSION_MS + 60_000,
  );

  it.skipIf(goAwayEnabled)(
    "F3-f — an arc episode opens with the recap",
    async () => {
      const arc: ArcContext = {
        title: "倫敦出差",
        episode: 2,
        planned: 6,
        recap: "你落地倫敦，這一週要向已經被延誤過一次的客戶交出成果。第一關先過入境，然後找到接送。",
        storyState: { characters: [{ name: "Oliver", note: "英國同事" }], events: ["抵達希斯洛"], openThreads: ["樣品還沒找到"] },
        isFinal: false,
      };
      const sc = { ...scenarioFor(hotel), id: "synthetic-arc", contentContext: "Heathrow arrivals hall; the learner has just landed.", coachRole: "the driver sent to pick them up", objectives: ["find your driver"] };
      const run = await runScript({ scenario: sc, lines: ["Hello, I have just arrived."], arc });
      const first = run.transcript.find((t) => t.who === "coach")?.text ?? "";
      const hit = ["倫敦", "入境", "客戶", "接送", "延誤"].filter((k) => first.includes(k));
      verdict("F3-f 前情提要為首句", hit.length >= 2, `首個 coach turn 命中關鍵詞 ${hit.join("、") || "無"}：「${first.slice(0, 140)}」`);
      expect(hit.length).toBeGreaterThanOrEqual(2);
    },
    MAX_SESSION_MS + 60_000,
  );

  it.skipIf(goAwayEnabled)(
    "F3-i — Chinese inside an English or Japanese sentence survives recognition and is coached",
    async () => {
      const en = await runScript({ scenario: scenarioFor(enMixed), lines: learnerLines(enMixed) });
      expect(en.elapsedMs).toBeLessThanOrEqual(MAX_SESSION_MS);
      const enAnnotated = annotateTurns(en.transcript, "en");
      const mixedIdx = enAnnotated.findIndex((t) => t.who === "user" && /\p{Script=Han}/u.test(t.text));
      const mixedTurn = enAnnotated[mixedIdx];
      const nextCoach = enAnnotated.slice(mixedIdx + 1).find((t) => t.who === "coach")?.text ?? "";
      record(`- en 逐字稿（learner）：${enAnnotated.filter((t) => t.who === "user").map((t) => `[${t.l1 ? "l1" : "-"}] ${t.text}`).join(" ‖ ")}`);
      const enOk = mixedIdx >= 0 && mixedTurn?.l1 === true && /book|reserv/i.test(nextCoach);
      const enSpoke = en.transcript.some((t) => t.who === "user") && en.transcript.some((t) => t.who === "coach");
      verdict("F3-i en 夾雜中文", enOk, `含 Han 的 learner turn=${mixedIdx >= 0 ? `「${mixedTurn?.text}」 l1=${mixedTurn?.l1 === true}` : "無（U5：ASR 未保留中文字元，en 半邊未驗證）"}；教練下一 turn 含 book/reserve=${/book|reserv/i.test(nextCoach)}`);
      if (mixedIdx < 0) record("- U5 觸發：Live 的輸入逐字稿未保留英文句中的中文字元；en 的 l1 改由 judge l1Fallbacks 回填（機制不變，來源改一處）。");
      expect(enSpoke).toBe(true);

      const ja = await runScript({ scenario: scenarioFor(jaMixed), lines: learnerLines(jaMixed) });
      const m = memoryDeps();
      const out = await finalizeSession(apiKey, {
        scenario: scenarioFor(jaMixed),
        profile: DEFAULT_PROFILE,
        sessionId: "synthetic-ja",
        startedAt: new Date().toISOString(),
        transcript: ja.transcript,
        aids: { suggestions: 0, translations: 0 },
      }, m.deps);
      const rec = m.sessions.get("synthetic-ja")!;
      record(`- ja 逐字稿（learner）：${rec.transcript.filter((t) => t.who === "user").map((t) => `[${t.l1 ? "l1" : "-"}] ${t.text}`).join(" ‖ ")}`);
      const fallbacks = rec.review?.l1Fallbacks ?? [];
      verdict("F3-i ja l1Fallbacks", out.kind === "done" && out.judge.kind === "review" && fallbacks.length > 0, `judge=${out.kind === "done" ? out.judge.kind : out.kind}，l1Fallbacks=${JSON.stringify(fallbacks)}，objectivesMet=${JSON.stringify(rec.review?.objectivesMet ?? [])}`);
      record(`- U6 讀數（合成 1 場）：ja「予約する」判 met=${rec.review?.objectivesMet?.find((o) => o.objective.includes("予約"))?.met ?? "—"}`);
      expect(enOk || mixedIdx < 0).toBe(true); // a transliterated transcript is U5, logged, not a defect of the pipeline
      expect(fallbacks.length).toBeGreaterThan(0);
    },
    2 * MAX_SESSION_MS + 120_000,
  );

  it.skipIf(!goAwayEnabled)(
    "F3-g — GoAway hand-over: reconnecting → resumed with memory, transcript kept",
    async () => {
      const sc = { ...scenarioFor(hotel), id: "synthetic-goaway" };
      const run = await runScript({ scenario: sc, lines: learnerLines(hotel), loopUntilMs: GOAWAY_LOOP_MS });
      expect(run.elapsedMs).toBeLessThanOrEqual(GOAWAY_MAX_MS);
      const ok = run.reconnectingSeen && run.resumedWithMemory === true && run.transcript.length > 0;
      verdict("F3-g GoAway 續接", ok, `${Math.round(run.elapsedMs / 1000)} 秒內 reconnecting=${run.reconnectingSeen}，resumed(with memory)=${run.resumedWithMemory}，turns=${run.transcript.length}，sent=${run.sent}`);
      expect(ok).toBe(true);
    },
    GOAWAY_MAX_MS + 60_000,
  );
});
