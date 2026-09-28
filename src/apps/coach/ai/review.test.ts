import { describe, expect, it, vi } from "vitest";

import { Invalid } from "../../../kernel/validate";
import type { generateJson } from "./client";
import { ANNOTATION_FIXTURES } from "./fixtures/transcripts";
import { judgePrompt, judgeTranscriptText, reviewParser, summariseSession, unjudgeable } from "./review";

const learner = ["I goed to the office yesterday.", "We discuss the budget."];
const coach = ["Good morning. Watch the th in think — think, not sink.", "How was your day?"];
const parse = reviewParser(learner, coach);

const good = {
  cefr: "B1",
  subscores: { grammar: 3, vocab: 4, fluency: 3, interaction: 4 },
  reviewEn: "Nice.",
  reviewZh: "不錯。",
  progressNote: "Past tense.",
  wins: ["kept going"],
  fixes: ["goed → went"],
  objectivesMet: [{ objective: "defend the budget", met: true }],
  errors: [{ type: "tense", example: "I goed to the office", correction: "I went to the office" }],
};

describe("judge validator — the recap claims only what the transcript can show", () => {
  it("accepts a well-formed sample and derives CEFR from grammar/vocab/interaction, not the headline", () => {
    const r = parse({ ...good, cefr: "C2" }, "$");
    expect(r.cefr).toBe("B2"); // (3+4+4)/3 = 3.67 → round 4 → B2
    expect(r.errors).toHaveLength(1);
    expect(r.objectivesMet).toEqual([{ objective: "defend the budget", met: true }]);
  });

  it("does not void a sample over the model's own cefr label (it is derived, not used)", () => {
    expect(parse({ ...good, cefr: "B1+" }, "$").cefr).toBe("B2");
  });

  it("rejects a sample with a subscore outside 1–6 (or missing)", () => {
    expect(() => parse({ ...good, subscores: { ...good.subscores, grammar: 9 } }, "$")).toThrow(Invalid);
    expect(() => parse({ ...good, subscores: { grammar: 3, vocab: 3 } }, "$")).toThrow(Invalid);
    expect(() => parse({ ...good, subscores: undefined }, "$")).toThrow(Invalid);
  });

  it("drops an error whose example the learner never said (invented evidence)", () => {
    const r = parse(
      { ...good, errors: [{ type: "article", example: "I bought a apple", correction: "an apple" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("an example that appears only in a COACH turn is still invented evidence", () => {
    const withCoach = reviewParser(["I goed home."]);
    const r = withCoach(
      { ...good, errors: [{ type: "tense", example: "I goed to the office", correction: "went" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("drops a pronunciation error — a text transcript cannot evidence it", () => {
    const r = parse(
      { ...good, errors: [{ type: "pronunciation", example: "I goed", correction: "went" }] },
      "$",
    );
    expect(r.errors).toEqual([]);
  });

  it("a quote spanning two learner turns is invented evidence (no single turn contains it)", () => {
    const r = parse({ ...good, errors: [{ type: "tense", example: "yesterday. We discuss", correction: "x" }] }, "$");
    expect(r.errors).toEqual([]);
  });

  it("matches the example case- and whitespace-insensitively (ASR punctuation drift)", () => {
    const r = parse({ ...good, errors: [{ type: "tense", example: "  i GOED to the   office", correction: "went" }] }, "$");
    expect(r.errors).toHaveLength(1);
  });

  it("drops a malformed verdict but keeps the rest", () => {
    const r = parse({ ...good, objectivesMet: [{ objective: "x", met: "yes" }, { objective: "y", met: false }] }, "$");
    expect(r.objectivesMet).toEqual([{ objective: "y", met: false }]);
  });

  it("rejects a non-object response", () => {
    expect(() => parse("B1", "$")).toThrow(Invalid);
  });

  it("keeps an l1 fallback whose `said` the learner said; drops one they never said, and one with an empty target", () => {
    const r = parse(
      {
        ...good,
        l1Fallbacks: [
          { said: "the budget", target: "the budget" },
          { said: "預約", target: "book" },
          { said: "office", target: "" },
        ],
      },
      "$",
    );
    expect(r.l1Fallbacks).toEqual([{ said: "the budget", target: "the budget" }]);
  });

  it("caps l1 fallbacks at five and omits the field when none survive", () => {
    const many = Array.from({ length: 7 }, () => ({ said: "office", target: "x" }));
    expect(parse({ ...good, l1Fallbacks: many }, "$").l1Fallbacks).toHaveLength(5);
    expect(parse({ ...good, l1Fallbacks: [{ said: "nope", target: "x" }] }, "$").l1Fallbacks).toBeUndefined();
  });

  it("keeps a pronunciation note the COACH said; drops an invented one and one from a learner turn", () => {
    const r = parse(
      { ...good, pronunciationNotes: ["watch the th in think", "mind your r sound", "I goed to the office"] },
      "$",
    );
    expect(r.pronunciationNotes).toEqual(["watch the th in think"]);
  });

  it("caps pronunciation notes at three", () => {
    const r = parse({ ...good, pronunciationNotes: ["think", "sink", "how was", "your day", "not sink"] }, "$");
    expect(r.pronunciationNotes).toHaveLength(3);
  });
});

describe("judge prompt — what the model is told", () => {
  it("labels echo and Chinese turns in the transcript it sends, and only learner turns", () => {
    const text = judgeTranscriptText([
      { who: "coach", text: "Say hello", echo: true },
      { who: "user", text: "Say hello", echo: true },
      { who: "user", text: "I want 預約", l1: true },
      { who: "user", text: "plain" },
    ]);
    expect(text).toBe("coach: Say hello\nuser: [repeated after coach] Say hello\nuser: [contains Chinese] I want 預約\nuser: plain");
  });

  it("states the met rule, the labels' meaning, the fallback field and the near-homophone caution", () => {
    const p = judgePrompt({ transcript: [{ who: "user", text: "hi" }], level: "B1", objectives: ["o"] });
    expect(p).toContain("entirely in the target language");
    expect(p).toContain("[repeated after coach]");
    expect(p).toContain("[contains Chinese]");
    expect(p).toContain("l1Fallbacks");
    expect(p).toContain("pronunciationNotes");
    expect(p).toContain("merely sounds like");
  });
});

describe("summariseSession — transcripts that cannot be judged never reach the model", () => {
  const generate = vi.fn(async () => {
    throw new Error("must not be called");
  });

  it("all-echo: unavailable with a reason naming 複誦", async () => {
    const f = ANNOTATION_FIXTURES.find((x) => x.id === "en-echo")!;
    const annotated = f.transcript.map((t) => (t.who === "user" ? { ...t, echo: true as const } : t));
    const out = await summariseSession("k", { transcript: annotated, level: f.level }, { generate });
    expect(out).toMatchObject({ kind: "unavailable" });
    if (out.kind === "unavailable") expect(out.reason).toContain("複誦");
    expect(generate).not.toHaveBeenCalled();
  });

  it("all-Chinese: unavailable with a reason naming 中文", async () => {
    const out = await summariseSession(
      "k",
      { transcript: [{ who: "coach", text: "Hi" }, { who: "user", text: "我不知道", l1: true }], level: "A1" },
      { generate },
    );
    expect(out).toMatchObject({ kind: "unavailable" });
    if (out.kind === "unavailable") expect(out.reason).toContain("中文");
    expect(generate).not.toHaveBeenCalled();
  });

  it("unjudgeable: one plain learner turn among flagged ones is enough to judge", () => {
    expect(unjudgeable([{ who: "user", text: "a", echo: true }, { who: "user", text: "b" }])).toBeNull();
    expect(unjudgeable([{ who: "user", text: "a", echo: true }, { who: "user", text: "b", l1: true }])).toContain("複誦");
    expect(unjudgeable([{ who: "coach", text: "a" }])).toContain("沒有開口");
  });

  it("a judgeable transcript goes to the injected generator, which is what production replaces with the real call", async () => {
    const calls: string[] = [];
    const gen: typeof generateJson = async (_key, prompt, _schema, parse) => {
      calls.push(prompt);
      return parse({ ...good, cefr: "B1", errors: [] }, "$");
    };
    const out = await summariseSession("k", { transcript: [{ who: "user", text: "I goed to the office" }], level: "B1" }, { generate: gen, samples: 1 });
    expect(calls).toHaveLength(1);
    expect(out.kind).toBe("review");
  });
});
