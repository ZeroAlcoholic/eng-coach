import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE,
  type LearnedItem,
  type LearnerProfile,
  type Scenario,
} from "../../kernel/types";
import { band } from "./progress";
import { composeSystemInstruction } from "./prompt";

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
