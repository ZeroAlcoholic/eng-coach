import { describe, expect, it } from "vitest";

import { zhTwProblem } from "../../../kernel/zhTw";
import { ANNOTATION_FIXTURES, FIXTURES } from "./fixtures/transcripts";
import { parseArcSeed, parseEpisodeGeneration } from "./arc";
import { parseRawItems } from "./items";
import { parseSuggestions } from "./replies";
import { summariseSession } from "./review";
import { parseScenarioDraft } from "./scenario";
import { parseTranslation } from "./translate";

// Each Chinese field a model writes, both ways: Mainland usage is refused with
// a message naming the hit, Taiwan usage passes.
const BAD = ["软件", "信息", "这个"] as const;
const GOOD = ["軟體", "資訊", "這個"] as const;
const HIT: Record<(typeof BAD)[number], string> = { 软件: "『软』", 信息: "『信息』", 这个: "『这』" };

const scenario = (zh: string) => ({
  title: `新${zh}上線`,
  contentContext: `在會議室討論${zh}`,
  coachRole: "Mia, PM",
  userRole: "工程師",
  objectives: ["說明進度", `解釋${zh}`],
  targetPhrases: ["on track"],
});
const episode = (zh: string) => ({ ...scenario("好"), recap: `上一集提到${zh}。`, canDoIndexes: [1] });
const state = { characters: [], events: [], openThreads: [] };
const seed = (zh: string) => ({
  arcTitle: "A",
  premise: "p",
  canDos: ["能說明狀況", `能解釋${zh}`],
  outline: ["b1"],
  storyState: state,
  episode: episode("好"),
});

describe("Chinese fields refuse Mainland usage, one parser at a time", () => {
  for (const [i, bad] of BAD.entries()) {
    const good = GOOD[i];

    it(`scenario draft: ${bad} refused, ${good} passes`, () => {
      expect(() => parseScenarioDraft(scenario(bad), "$")).toThrow(HIT[bad]);
      expect(parseScenarioDraft(scenario(good), "$").objectives).toHaveLength(2);
    });

    it(`episode (incl. recap) and arc can-dos: ${bad} refused, ${good} passes`, () => {
      expect(() => parseEpisodeGeneration({ storyState: state, episode: episode(bad) }, "$")).toThrow(HIT[bad]);
      expect(parseEpisodeGeneration({ storyState: state, episode: episode(good) }, "$").episode.recap).toContain(good);
      expect(() => parseArcSeed(seed(bad), "$")).toThrow(HIT[bad]);
      expect(parseArcSeed(seed(good), "$").canDos).toHaveLength(2);
    });

    it(`item meaning: the ${bad} item is dropped, the ${good} item kept`, () => {
      const items = parseRawItems(
        { items: [{ kind: "word", text: "a", meaning: bad }, { kind: "word", text: "b", meaning: good }] },
        "$",
      );
      expect(items.map((x) => x.text)).toEqual(["b"]);
    });

    it(`reply gloss: the ${bad} suggestion is dropped, the ${good} one kept`, () => {
      const out = parseSuggestions({ suggestions: [{ say: "x", gloss: bad }, { say: "y", gloss: good }] }, "$");
      expect(out.map((s) => s.say)).toEqual(["y"]);
    });

    it(`translation: ${bad} refused, ${good} passes`, () => {
      expect(() => parseTranslation({ zh: bad }, "$")).toThrow(HIT[bad]);
      expect(parseTranslation({ zh: good }, "$")).toBe(good);
    });
  }

  it("arc title, premise, outline and story state: Mainland usage refused, Taiwan usage passes", () => {
    for (const [key, bad] of [
      ["arcTitle", "软件危機"],
      ["premise", "一切從信息外洩開始"],
      ["outline", ["機場", "这个會議"]],
    ] as const) {
      expect(() => parseArcSeed({ ...seed("好"), [key]: bad }, "$"), key).toThrow(/含(簡體字|中國用語)/);
    }
    for (const st of [
      { ...state, events: ["會議延期", "信息外洩"] },
      { ...state, openThreads: ["这个問題"] },
      { ...state, characters: [{ name: "Mia", note: "负责软件" }] },
    ]) {
      expect(() => parseEpisodeGeneration({ storyState: st, episode: episode("好") }, "$")).toThrow(/含(簡體字|中國用語)/);
    }
    const ok = { characters: [{ name: "田中さん", note: "飯店櫃台" }], events: ["會議延期"], openThreads: ["軟體還沒修好"] };
    expect(parseEpisodeGeneration({ storyState: ok, episode: episode("好") }, "$").storyState).toEqual(ok);
  });

  it("Japanese in objectives passes (shared kanji are not in the table)", () => {
    const ja = { ...scenario("好"), objectives: ["会計をお願いする", "学校の場所を聞く"] };
    expect(parseScenarioDraft(ja, "$").objectives).toHaveLength(2);
  });

  it("a Japanese contentContext with 会計／学校 is not refused", () => {
    const ja = { ...scenario("好"), contentContext: "会計の前に学校の話をする", coachRole: "店員の田中さん" };
    expect(parseScenarioDraft(ja, "$").contentContext).toBe("会計の前に学校の話をする");
  });
});

describe("judge: a sample with Mainland usage is discarded", () => {
  const transcript = [
    { who: "coach" as const, text: "Hi" },
    { who: "user" as const, text: "I goed to the office" },
  ];
  const sample = (over: object) => ({
    cefr: "B1",
    subscores: { grammar: 3, vocab: 3, fluency: 3, interaction: 3 },
    reviewEn: "ok",
    reviewZh: "不錯喔",
    progressNote: "n",
    wins: ["講得很清楚"],
    fixes: ["went，不是 goed"],
    errors: [],
    ...over,
  });
  // Stand-in for the model call only: the real parser still runs.
  const judgeWith = (raw: object) =>
    summariseSession("k", { transcript, level: "B1" }, { samples: 1, generate: async (_k, _p, _s, parse) => parse(raw, "$") });

  for (const [field, bad] of [
    ["wins", ["这个很好"]],
    ["fixes", ["请说 went"]],
    ["reviewZh", "信息很清楚"],
  ] as const) {
    it(`${field} with Mainland usage → no valid sample → unavailable, reason names the hit`, async () => {
      const out = await judgeWith(sample({ [field]: bad }));
      expect(out.kind).toBe("unavailable");
      if (out.kind === "unavailable") {
        expect(out.reason).toMatch(/含(簡體字|中國用語)/);
        expect(out.retryable).toBe(true);
      }
    });
  }

  it("a fix with a Japanese correction passes", async () => {
    expect((await judgeWith(sample({ fixes: ["会計をお願いします，不是 会計ください"] }))).kind).toBe("review");
  });

  it("Simplified text quoted verbatim from the learner is exempt; the judge's own Simplified is not", async () => {
    const t = [
      { who: "coach" as const, text: "What did you buy?" },
      { who: "user" as const, text: "I bought 这个 bag" },
    ];
    const run = (fix: string) =>
      summariseSession("k", { transcript: t, level: "B1" }, { samples: 1, generate: async (_k, _p, _s, parse) => parse(sample({ fixes: [fix] }), "$") });
    expect((await run("「这个」要說 this one")).kind).toBe("review");
    expect((await run("「这个」要說 this one，这样比较自然")).kind).toBe("unavailable");
  });

  it("the same sample in Taiwan usage is a review", async () => {
    expect((await judgeWith(sample({}))).kind).toBe("review");
  });
});

describe("fixtures are Taiwan Chinese", () => {
  it("no Chinese-bearing turn in the judge fixtures fails zhTwProblem", () => {
    const turns = [...FIXTURES, ...ANNOTATION_FIXTURES].flatMap((f) => f.transcript);
    expect(turns.some((t) => /[一-鿿]/.test(t.text))).toBe(true);
    for (const t of turns) expect(zhTwProblem(t.text), t.text).toBeNull();
  });
});
