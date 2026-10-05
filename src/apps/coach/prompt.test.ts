import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE,
  type LearnedItem,
  type LearnerProfile,
  type Scenario,
} from "../../kernel/types";
import { band } from "./progress";
import { microInstruction } from "./focus";
import { composeSystemInstruction, HELP_TRIGGERS, sessionInstruction, silenceNudges } from "./prompt";

const scenario: Scenario = {
  id: "s1",
  title: "t",
  targetLanguage: "en",
  level: "B1",
  baseContext: "frame",
  contentContext: "ctx",
  coachRole: "coach",
  userRole: "learner",
  objectives: [],
  targetPhrases: [],
};

function item(text: string): LearnedItem {
  return {
    id: "i1",
    language: "en",
    kind: "phrase",
    text,
    meaning: "m",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("composeSystemInstruction — due-item sanitisation", () => {
  it("flattens newlines/extra whitespace so one item can't break the line structure", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [
      item("circle\n back\tto   this"),
    ]);
    expect(out).toContain("circle back to this");
    expect(out).not.toContain("circle\n back");
  });

  it("caps oversized item text and drops whitespace-only items entirely", () => {
    const long = "x".repeat(500);
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [item(long), item("  \n ")]);
    expect(out).toContain("x".repeat(80));
    expect(out).not.toContain("x".repeat(81));
    const blankOnly = composeSystemInstruction(scenario, DEFAULT_PROFILE, [item("  \n ")]);
    expect(blankOnly).not.toContain("Spaced review");
  });

  it("omits the spaced-review block when there is nothing due", () => {
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE, [])).not.toContain("Spaced review");
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE)).not.toContain("Spaced review");
  });

  it("B2 — frames due items as unaided production, recast only on failure", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [item("circle back")]);
    expect(out).toContain("PRODUCE it");
    expect(out).toContain("UNAIDED");
    expect(out).toContain("circle back");
  });

  it("C2 — sorts due items into fading-scaffold tiers by review history", () => {
    const fresh = item("fresh phrase"); // no srs → model tier
    const seen = { ...item("seen phrase"), srs: { reps: 2 } }; // → cue tier
    const known = { ...item("known phrase"), srs: { reps: 9 } }; // → independent tier
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [fresh, seen, known]);
    expect(out).toMatch(/Model first[^\n]*fresh phrase/);
    expect(out).toMatch(/Leading cue[^\n]*seen phrase/);
    expect(out).toMatch(/Independent[^\n]*known phrase/);
  });
});

describe("composeSystemInstruction — objective ledger consumer (C1)", () => {
  it("injects still-developing objectives as priorities when provided", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], ["order a coffee"]);
    expect(out).toContain("still aren't solid");
    expect(out).toContain("order a coffee");
  });
  it("omits the priority block when there are no weak objectives", () => {
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE)).not.toContain("still aren't solid");
  });
});

describe("composeSystemInstruction — coaching prompt logic (Batch B)", () => {
  it("B1 — always includes hands-free voice-help handling", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("Hands-free help");
    expect(out).toContain("慢一點");
    expect(out).toContain("怎麼說");
  });

  it("B3 — always opens with a pre-task planning beat and a think pause", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("planning beat");
    expect(out).toContain("給你幾秒想一下");
  });
});

describe("composeSystemInstruction — S2 story arcs", () => {
  const arcContext = {
    title: "London Calling",
    episode: 3,
    planned: 6,
    recap: "你昨天抵達倫敦。行李還沒送到。今晚要和 Oliver 補完簡報。",
    storyState: {
      characters: [{ name: "Oliver Harris", note: "英國同事" }],
      events: ["抵達希斯洛", "行李遺失"],
      openThreads: ["樣品還沒找到"],
    },
    isFinal: false,
  };

  it("puts the recap FIRST in the opening order, ahead of the planning beat", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], arcContext);
    const recapAt = out.indexOf("前情提要 FIRST");
    const planAt = out.indexOf("Then the planning beat");
    expect(recapAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(recapAt);
    expect(out).toContain(arcContext.recap);
    expect(out).toContain("AT MOST 3 short sentences");
    expect(out).toContain("給你幾秒想一下"); // the B3 beat survives, it just moves後
  });

  it("states where the episode sits and forbids contradicting the continuity", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], arcContext);
    expect(out).toContain("第 3 集");
    expect(out).toContain("約 6 集");
    expect(out).toContain("Oliver Harris");
    expect(out).toContain("抵達希斯洛 → 行李遺失");
    expect(out).toContain("樣品還沒找到");
  });

  it("closes a mid-arc episode with a tease, and the final episode with a resolution", () => {
    const mid = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], arcContext);
    expect(mid).toContain("下一集預告");
    expect(mid).not.toContain("FINAL episode");

    const last = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], {
      ...arcContext,
      episode: 6,
      isFinal: true,
    });
    expect(last).toContain("FINAL episode");
    expect(last).not.toContain("下一集預告");
  });

  it("falls back to the plain B3 opening when the arc has no recap", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], {
      ...arcContext,
      recap: undefined,
    });
    expect(out).toContain("Open with a short planning beat");
    expect(out).not.toContain("前情提要 FIRST");
    expect(out).toContain("第 3 集"); // continuity still applies
  });

  it("leaves a standalone scenario's instruction untouched (no arc wording at all)", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).not.toContain("連續劇");
    expect(out).not.toContain("前情提要");
  });
});

describe("composeSystemInstruction — E1 measured recurring mistakes", () => {
  const withTally = (count: number): LearnerProfile => ({
    ...DEFAULT_PROFILE,
    errorLog: {
      en: {
        tense: {
          count,
          lastAt: "2026-08-01T00:00:00.000Z",
          example: "I go yesterday",
          correction: "I went yesterday",
        },
      },
    },
  });

  it("names the 繁中 label with the learner's own slip once it recurs", () => {
    const out = composeSystemInstruction(scenario, withTally(3));
    expect(out).toContain("measured recurring mistakes");
    expect(out).toContain("時態 (tense), seen in 3 sessions");
    expect(out).toContain("I go yesterday");
    expect(out).toContain("I went yesterday");
    expect(out).toContain("prompt self-repair");
  });

  it("says NOTHING for a one-off — a single session is not a habit", () => {
    const out = composeSystemInstruction(scenario, withTally(1));
    expect(out).not.toContain("measured recurring mistakes");
    expect(out).not.toContain("時態");
  });

  it("keeps the block out of a language the learner has no tally for", () => {
    const ja: Scenario = { ...scenario, targetLanguage: "ja" };
    expect(composeSystemInstruction(ja, withTally(3))).not.toContain("measured recurring mistakes");
  });

  // no-gamification red line: the LIVE coach must never be told to score the
  // learner. (The end-of-session judge does produce a CEFR band — that is a
  // different surface and deliberately not part of the conversation.)
  it("never instructs the live coach to score, grade or rate the learner", () => {
    const out = composeSystemInstruction(scenario, withTally(3));
    expect(out).not.toMatch(/score (them|the learner)|give .*(a score|a grade)/i);
    expect(out).not.toMatch(/out of (ten|10|five|5|100)/i);
    expect(out).not.toMatch(/打分|給.{0,4}分數|評分/);
  });
});

describe("composeSystemInstruction — Phase E: accent, code-mixing, continuity", () => {
  const ja: Scenario = { ...scenario, targetLanguage: "ja" };

  it("E1 — names the closed list of sounds and drops the old open-ended accent feedback", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("/l/ vs /n/ vs /r/"); // highest functional load for Mandarin-L1, not /θ/
    expect(out).not.toContain("/θ/");
    expect(out).toContain("/iː/ vs /ɪ/");
    expect(out).toContain("word stress");
    expect(out).toContain("sentence stress");
    expect(out).toContain("at most once every three or four exchanges");
    expect(out).not.toContain("brief, specific accent feedback");
    expect(out).toContain("Never rate their accent");
    const jp = composeSystemInstruction(ja, DEFAULT_PROFILE);
    expect(jp).toContain("small っ");
    expect(jp).toContain("voiced vs voiceless");
    expect(jp).not.toContain("pitch accent");
  });

  it("E4 — the code-mixing section exists for both languages and the help section is unchanged", () => {
    const en = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(en).toContain("VOCABULARY GAP");
    expect(en).toContain("say the WHOLE sentence again in English");
    expect(en).toContain("without switching your own turn into Chinese");
    const jp = composeSystemInstruction(ja, DEFAULT_PROFILE);
    expect(jp).toContain("VOCABULARY GAP");
    expect(jp).toContain("say the WHOLE sentence again in Japanese only");
    for (const out of [en, jp]) {
      expect(out).toContain("── Hands-free help — the learner can ask for help out loud (B1) ──");
      expect(out).toContain("「我不知道怎麼回 / 卡住了 / 提示一下」 → offer TWO short example answers");
      expect(out).toContain("first sound as a cue");
    }
  });

  it("the help triggers the prompt lists are the ones annotate.ts matches (single source)", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    for (const t of HELP_TRIGGERS) expect(out).toContain(`「${t}」`);
  });

  it("E2 — lists the sounds the coach named last time, for the practised language only", () => {
    const profile: LearnerProfile = { ...DEFAULT_PROFILE, accentNotes: { en: ["the th in think"], ja: ["おばあさん"] } };
    const out = composeSystemInstruction(scenario, profile);
    expect(out).toContain("Sounds you pointed out last time");
    expect(out).toContain("the th in think");
    expect(out).not.toContain("おばあさん");
    expect(composeSystemInstruction(scenario, DEFAULT_PROFILE)).not.toContain("Sounds you pointed out");
  });
});

describe("sessionInstruction — D3: a micro session carries no due items, weak objectives or story", () => {
  const due = [item("circle back")];
  const weak = ["order a coffee"];
  const arc = {
    title: "London Calling",
    episode: 2,
    planned: 6,
    recap: "你昨天抵達倫敦。",
    storyState: { characters: [], events: [], openThreads: [] },
    isFinal: false,
  };
  const micro = microInstruction({ kind: "cando", objective: "ask for a discount" });

  it("micro: none of the three blocks; the drill block is present", () => {
    const out = sessionInstruction({ scenario, profile: DEFAULT_PROFILE, dueItems: due, weakObjectives: weak, arc, micro });
    expect(out).not.toContain("Spaced review");
    expect(out).not.toContain("still aren't solid");
    expect(out).not.toContain("連續劇");
    expect(out).toContain("90-SECOND FOCUSED FOLLOW-UP");
    expect(out).toContain("ask for a discount");
  });

  it("full session: all three blocks, no drill block", () => {
    const out = sessionInstruction({ scenario, profile: DEFAULT_PROFILE, dueItems: due, weakObjectives: weak, arc });
    expect(out).toContain("Spaced review");
    expect(out).toContain("still aren't solid");
    expect(out).toContain("連續劇");
    expect(out).not.toContain("90-SECOND FOCUSED FOLLOW-UP");
    expect(out).toBe(composeSystemInstruction(scenario, DEFAULT_PROFILE, due, weak, arc));
  });
});

describe("band — display mapping for per-skill subscores", () => {
  it("maps 1–6 to CEFR letters", () => {
    expect(band(1)).toBe("A1");
    expect(band(6)).toBe("C2");
  });
  it("shows — (not A1) for missing/zero/out-of-range, unlike numToCefr's clamp", () => {
    expect(band(0)).toBe("—");
    expect(band(7)).toBe("—");
  });
});

describe("composeSystemInstruction — the coach carries the conversation", () => {
  it("tells the coach to own the agenda and never to leave the topic to the learner", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("You carry the conversation");
    expect(out).toContain("4–6 BEATS");
    expect(out).toContain("Never ask what they want to talk about");
    expect(out).toContain("DIG DEEPER");
    expect(out).not.toContain("don't fill the silence"); // the old rule that made it wait passively
  });

  it("explains the silence stage directions the session owner will send", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("stage direction");
    for (const lang of ["en", "ja"] as const) {
      const nudges = silenceNudges(lang);
      expect(nudges.length).toBeGreaterThanOrEqual(2);
      for (const n of nudges) expect(n).toMatch(/^\(.*\)$/); // a direction, never the learner's words
    }
  });

  it("Japanese: the coach still owns the agenda, but teaches each line (kana + romaji + 繁中) and never asks why", () => {
    const ja = composeSystemInstruction({ ...scenario, targetLanguage: "ja", level: "A1" }, DEFAULT_PROFILE);
    expect(ja).toContain("You carry the conversation");
    expect(ja).toContain("Never ask what they want to talk about");
    expect(ja).toContain("mora by mora");
    expect(ja).not.toContain("kana + romaji"); // voice-only: never spelt aloud
    expect(ja).toContain("Never spell kana or romaji out loud");
    expect(ja).toContain("The Chinese explanation is not optional");
    expect(ja).toContain("Choice questions (A か B か) are the DEFAULT");
    expect(ja).not.toContain("never yes/no"); // that rule is English-only
    expect(ja).toContain("Never ask「どうして？」");
    expect(ja).not.toContain("push back gently on their view");
    expect(ja).not.toContain("DIG DEEPER");
    const en = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(en).toContain("DIG DEEPER");
    expect(en).not.toContain("どうして");
  });

  it("Japanese silence nudges hand over the Japanese line with a Chinese explanation", () => {
    for (const n of silenceNudges("ja")) {
      expect(n).toContain("Traditional Chinese");
    }
    expect(silenceNudges("ja")[0]).toContain("mora by mora");
    expect(silenceNudges("ja")[0]).toContain("say in Chinese"); // the L1 route comes FIRST for a comprehension-ahead beginner
    expect(silenceNudges("en")[0]).not.toContain("TWO short example answers"); // wait-time: room first, answers second
    expect(silenceNudges("en")[1]).toContain("TWO short example answers");
    expect(silenceNudges("ja")).not.toEqual(silenceNudges("en"));
  });

  it("frames the progress note as coaching targets, not as a conversation to resume", () => {
    const out = composeSystemInstruction({ ...scenario, progressNote: "past tense of irregular verbs" }, DEFAULT_PROFILE);
    expect(out).toContain("Coaching targets carried over");
    expect(out).toContain("past tense of irregular verbs");
    expect(out).toContain("do NOT mention 'last time'");
    expect(out).not.toContain("Where the learner left off");
  });

  it("a replayed standalone scenario is told to run a fresh variation, never to resume", () => {
    const first = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], undefined, 0);
    expect(first).not.toContain("FRESH variation");
    const again = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], undefined, 2);
    expect(again).toContain("already been practised 2 times");
    expect(again).toContain("FRESH variation");
    expect(again).toContain("Do NOT resume");
    const once = composeSystemInstruction(scenario, DEFAULT_PROFILE, [], [], undefined, 1);
    expect(once).toContain("already been practised 1 time —");
  });

  it("an arc episode keeps its continuity even when replayed (the arc, not the replay rule, owns the story)", () => {
    const arc = {
      title: "A",
      episode: 2,
      planned: 6,
      storyState: { characters: [], events: [], openThreads: [] },
      isFinal: false,
    };
    const out = composeSystemInstruction({ ...scenario, arc: { arcId: "a", episode: 2 } }, DEFAULT_PROFILE, [], [], arc, 1);
    expect(out).not.toContain("FRESH variation");
    expect(out).toContain("第 2 集");
  });

  it("an arc episode whose arc record could not be read is still never told to run a fresh variation", () => {
    const out = composeSystemInstruction({ ...scenario, arc: { arcId: "a", episode: 2 } }, DEFAULT_PROFILE, [], [], undefined, 1);
    expect(out).not.toContain("FRESH variation");
  });

  it("sessionInstruction passes priorPlays through for a full session and drops it for a micro drill", () => {
    const base = { scenario, profile: DEFAULT_PROFILE, dueItems: [], weakObjectives: [] };
    expect(sessionInstruction({ ...base, priorPlays: 3 })).toContain("FRESH variation");
    expect(sessionInstruction({ ...base, priorPlays: 3, micro: "\nDRILL" })).not.toContain("FRESH variation");
  });
});

describe("composeSystemInstruction — pedagogy calibration (one correction policy, turn budget, closing order)", () => {
  it("runs ONE correction policy per phase: recast-and-go during, prompt only when meaning breaks, form work after", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("ONE policy per phase");
    expect(out).toContain("recast it once, folded naturally into your reply, and do NOT ask them to repeat");
    expect(out).toContain("ONE self-repair prompt");
    expect(out).not.toContain("first echo the gist back"); // the per-turn recast+repeat that ran alongside
    expect(out).not.toContain("Prompts beat silent recasts");
  });

  it("caps the per-turn load and orders the closing (scene → form → can-do)", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("TURN BUDGET");
    expect(out).toContain("Closing order");
    expect(out.indexOf("Close the scene IN character")).toBeLessThan(out.indexOf("Step OUT of character"));
  });

  it("English: fragments are rebuilt and repeated up to B1, folded in from B2", () => {
    expect(composeSystemInstruction({ ...scenario, level: "B1" }, DEFAULT_PROFILE)).toContain("GATHER their words");
    const b2 = composeSystemInstruction({ ...scenario, level: "B2" }, DEFAULT_PROFILE);
    expect(b2).not.toContain("GATHER their words");
    expect(b2).toContain("fold the complete natural sentence");
  });

  it("scaffolding is stated as triggers, not percentages the model cannot measure", () => {
    for (const level of ["A1", "B1", "C1"] as const) {
      const en = composeSystemInstruction({ ...scenario, level }, DEFAULT_PROFILE);
      const ja = composeSystemInstruction({ ...scenario, targetLanguage: "ja", level }, DEFAULT_PROFILE);
      expect(en).not.toMatch(/~\d+%/);
      expect(ja).not.toMatch(/~\d+%/);
    }
    expect(composeSystemInstruction({ ...scenario, targetLanguage: "ja", level: "A1" }, DEFAULT_PROFILE)).toContain(
      "a short gloss after each Japanese line",
    );
  });

  it("help requests step out of the role for one line instead of being answered in character", () => {
    const out = composeSystemInstruction(scenario, DEFAULT_PROFILE);
    expect(out).toContain("step OUT of the role for one line");
    expect(out).not.toContain("briefly IN CHARACTER");
  });
});
