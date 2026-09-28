// SCREENING, not a unit test: calls the real text model and costs money.
// Runs only with SCREEN=1 and GEMINI_API_KEY in the environment:
//   SCREEN=1 npx vitest run src/apps/coach/ai/review.screen.test.ts
// Writes docs/SCREENING_<date>.md. Vocabulary is deliberately limited to
//「晉級／淘汰」— ten fixtures are a screen, not an evaluation.
//
// Screens the SHIPPED judge model only (kernel/overrides): the point is to
// know how the judge the learner actually gets behaves on the rules the prompt
// sets, and to re-run only when that model changes. Cost is bounded in code:
// at most MAX_FIXTURES × CALLS_PER_FIXTURE calls, asserted before any call.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_TEXT_MODEL } from "../../../kernel/overrides";
import { record } from "../../../kernel/validate";
import { annotateTurns } from "../annotate";
import { cefrToNum } from "../progress";
import { generateJson } from "./client";
import { ANNOTATION_FIXTURES, FIXTURES, type JudgeFixture } from "./fixtures/transcripts";
import { judgePrompt, REVIEW_SCHEMA, reviewParser, summariseSession } from "./review";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SCREEN === "1" && apiKey.length > 0;

const MODEL = DEFAULT_TEXT_MODEL;
const CALLS_PER_FIXTURE = 5;
const MAX_FIXTURES = 6; // the GOAL's cap: ≤ 6 fixtures × 5 calls per model
// The six screened fixtures: three scored English bands, the Japanese one, the
// coach-only one, and the two code-mixing ones (which replace two of the
// original scored fixtures so the cap holds).
const SCREENED: JudgeFixture[] = [
  FIXTURES.find((f) => f.id === "en-a2-hotel")!,
  FIXTURES.find((f) => f.id === "en-b2-negotiation")!,
  FIXTURES.find((f) => f.id === "ja-a1-ramen")!,
  FIXTURES.find((f) => f.id === "coach-only")!,
  ANNOTATION_FIXTURES.find((f) => f.id === "en-mixed")!,
  ANNOTATION_FIXTURES.find((f) => f.id === "ja-mixed")!,
];

// Rules fixed BEFORE the run. 晉級 iff every line holds.
const RULES = {
  validatorFailure: 0.05, // ≤ 5% of calls fail the validator
  exampleHitRate: 0.9, // ≥ 90% of reported error examples are real substrings
  typeRecall: 0.5, // ≥ half of the reader's expected error types are reported (over scored fixtures)
  mixedNotMet: 0.8, // ≥ 4/5 of calls grade the Chinese-completed objective NOT met
  fallbackHit: 0.8, // ≥ 4/5 of reported l1Fallbacks.said are substrings
};

interface Stats {
  calls: number;
  invalid: number;
  latenciesMs: number[];
  errorsReported: number;
  errorsKept: number;
  typeExpected: number;
  typeHit: number;
  bandHits: number;
  bandTotal: number;
  unavailableCorrect: boolean | null;
  mixedCalls: number;
  mixedNotMet: number;
  fallbacksReported: number;
  fallbacksKept: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};

describe.skipIf(!enabled)("judge screening — shipped model, prompt-rule compliance (paid, opt-in)", () => {
  it(
    "writes the screening table",
    async () => {
      expect(SCREENED.length).toBeLessThanOrEqual(MAX_FIXTURES);
      const calls = SCREENED.length * CALLS_PER_FIXTURE;
      console.log(`估價：judge ${MODEL} ≤ ${calls} 次呼叫（${SCREENED.length} fixture × ${CALLS_PER_FIXTURE}），每次 ≈ 1.5k tokens in / 0.4k out`);
      const st: Stats = { calls: 0, invalid: 0, latenciesMs: [], errorsReported: 0, errorsKept: 0, typeExpected: 0, typeHit: 0, bandHits: 0, bandTotal: 0, unavailableCorrect: null, mixedCalls: 0, mixedNotMet: 0, fallbacksReported: 0, fallbacksKept: 0 };
      const perFixture: string[] = [];

      for (const f of SCREENED) {
        const transcript = annotateTurns(f.transcript, f.language);
        const learner = transcript.filter((t) => t.who === "user").map((t) => t.text);
        const coach = transcript.filter((t) => t.who === "coach").map((t) => t.text);
        if (f.expectBand === null) {
          const out = await summariseSession(apiKey, { transcript, level: f.level, objectives: f.objectives }, { model: MODEL, samples: 1 });
          st.calls++;
          st.unavailableCorrect = out.kind === "unavailable";
          perFixture.push(`| ${f.id} | — | — | — | unavailable=${out.kind === "unavailable"} |`);
          continue;
        }
        const parse = reviewParser(learner, coach);
        const prompt = judgePrompt({ transcript, level: f.level, objectives: f.objectives });
        const cefrs: number[] = [];
        const typesSeen = new Set<string>();
        let notMet = 0;
        let fbReported = 0;
        let fbKept = 0;
        for (let i = 0; i < CALLS_PER_FIXTURE; i++) {
          expect(st.calls).toBeLessThan(MAX_FIXTURES * CALLS_PER_FIXTURE);
          const t0 = performance.now();
          let raw: Record<string, unknown> | null = null;
          try {
            raw = await generateJson(apiKey, prompt, REVIEW_SCHEMA, record, { model: MODEL });
          } catch {
            /* counted below as invalid */
          }
          st.latenciesMs.push(performance.now() - t0);
          st.calls++;
          if (!raw) {
            st.invalid++;
            continue;
          }
          const reported = Array.isArray(raw.errors) ? raw.errors.length : 0;
          const fbRaw = Array.isArray(raw.l1Fallbacks) ? raw.l1Fallbacks.length : 0;
          st.errorsReported += reported;
          try {
            const review = parse(raw, "$");
            st.errorsKept += review.errors?.length ?? 0;
            for (const e of review.errors ?? []) typesSeen.add(e.type);
            cefrs.push(cefrToNum(review.cefr));
            if (f.expectMixed) {
              st.mixedCalls++;
              const v = review.objectivesMet?.find((o) => o.objective === f.expectMixed!.objectiveNotMet);
              if (v && !v.met) {
                st.mixedNotMet++;
                notMet++;
              }
              fbReported += fbRaw;
              fbKept += review.l1Fallbacks?.length ?? 0;
            }
          } catch {
            st.invalid++;
          }
        }
        st.fallbacksReported += fbReported;
        st.fallbacksKept += fbKept;
        for (const t of f.expectErrorTypes) {
          st.typeExpected++;
          if (typesSeen.has(t)) st.typeHit++;
        }
        if (cefrs.length) {
          st.bandTotal++;
          if (Math.abs(Math.round(median(cefrs)) - cefrToNum(f.expectBand)) <= 1) st.bandHits++;
        }
        perFixture.push(
          `| ${f.id} | ${cefrs.length ? Math.round(median(cefrs)) : "—"} (期望 ${cefrToNum(f.expectBand)}) | ${[...typesSeen].join(",") || "—"} (期望 ${f.expectErrorTypes.join(",") || "—"}) | ${f.expectMixed ? `${notMet}/${CALLS_PER_FIXTURE} not met；fallback ${fbKept}/${fbReported}` : "—"} | — |`,
        );
      }

      const invalidRate = st.invalid / Math.max(1, st.calls);
      const hitRate = st.errorsReported ? st.errorsKept / st.errorsReported : 1;
      const typeRecall = st.typeExpected ? st.typeHit / st.typeExpected : 1;
      const mixedRate = st.mixedCalls ? st.mixedNotMet / st.mixedCalls : 0;
      const fallbackRate = st.fallbacksReported ? st.fallbacksKept / st.fallbacksReported : 0;
      const pass =
        invalidRate <= RULES.validatorFailure &&
        hitRate >= RULES.exampleHitRate &&
        typeRecall >= RULES.typeRecall &&
        mixedRate >= RULES.mixedNotMet &&
        fallbackRate >= RULES.fallbackHit &&
        st.unavailableCorrect === true;
      const date = new Date().toISOString().slice(0, 10);
      const lines = [
        `# Judge screening — ${date}`,
        "",
        `Model: ${MODEL} (the shipped judge). Fixtures: ${SCREENED.length} synthetic transcripts (src/apps/coach/ai/fixtures/transcripts.ts), ${CALLS_PER_FIXTURE} calls per scored fixture, ${st.calls} calls in all.`,
        "Vocabulary: screening only —「晉級／淘汰」. Not an evaluation.",
        "",
        "| validator failure | error-example hit rate | type recall | band within ±1 | coach-only → unavailable | mixed objective NOT met | l1Fallbacks.said hit rate | median latency (ms) |",
        "|---|---|---|---|---|---|---|---|",
        `| ${(invalidRate * 100).toFixed(1)}% | ${(hitRate * 100).toFixed(0)}% | ${st.typeHit}/${st.typeExpected} | ${st.bandHits}/${st.bandTotal} | ${st.unavailableCorrect} | ${st.mixedNotMet}/${st.mixedCalls} | ${st.fallbacksKept}/${st.fallbacksReported} | ${median(st.latenciesMs).toFixed(0)} |`,
        "",
        "| fixture | median band | error types reported | code-mixing | note |",
        "|---|---|---|---|---|",
        ...perFixture,
        "",
        `**${MODEL} on the Phase D/E prompt rules: ${pass ? "晉級" : "淘汰"}.**`,
        "",
        `Rules were fixed before the run: validator failure ≤ ${RULES.validatorFailure * 100}%, example hit rate ≥ ${RULES.exampleHitRate * 100}%, type recall ≥ ${RULES.typeRecall * 100}%, coach-only unavailable, Chinese-completed objective graded not met in ≥ ${RULES.mixedNotMet * 100}% of calls (U6), reported l1Fallbacks.said real substrings in ≥ ${RULES.fallbackHit * 100}%.`,
        `If 淘汰 on the code-mixing rule: the fallback is a program-side rule (an objective whose text matches an l1Fallbacks.target is forced not met), not a new field — see docs/BLUEPRINT_2026-09-28.md U6.`,
      ];
      mkdirSync("docs", { recursive: true });
      writeFileSync(`docs/SCREENING_${date}.md`, lines.join("\n") + "\n");
      console.log(lines.join("\n"));
      expect(st.calls).toBeLessThanOrEqual(MAX_FIXTURES * CALLS_PER_FIXTURE);
    },
    15 * 60 * 1000,
  );
});
