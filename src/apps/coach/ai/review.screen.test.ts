// SCREENING, not a unit test: calls the real text models and costs money.
// Runs only with SCREEN=1 and GEMINI_API_KEY in the environment:
//   SCREEN=1 npx vitest run src/apps/coach/ai/review.screen.test.ts
// Writes docs/SCREENING_<date>.md. Vocabulary is deliberately limited to
//「晉級／淘汰」— six fixtures are a screen, not an evaluation.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CEFR_LEVELS } from "../../../kernel/types";
import { record } from "../../../kernel/validate";
import { cefrToNum } from "../progress";
import { generateJson } from "./client";
import { FIXTURES } from "./fixtures/transcripts";
import { judgePrompt, REVIEW_SCHEMA, reviewParser, summariseSession } from "./review";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const enabled = process.env.SCREEN === "1" && apiKey.length > 0;

const MODELS = ["gemini-3.5-flash", "gemini-3.8-flash"] as const;
const CALLS_PER_FIXTURE = 15; // 5 medians-of-3; the first 5 also serve as 1-sample runs


interface ModelStats {
  calls: number;
  invalid: number;
  errorsReported: number;
  errorsKept: number;
  latenciesMs: number[];
  std1: number[]; // per fixture: std of cefr over 5 single samples
  std3: number[]; // per fixture: std of cefr over 5 medians-of-3
  bandHits: number; // fixtures whose median band is within ±1 of the reader's
  bandTotal: number;
  unavailableCorrect: boolean | null; // the coach-only fixture must be unavailable
}

const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

describe.skipIf(!enabled)("judge screening — model and sample count (paid, opt-in)", () => {
  it(
    "writes the screening table",
    async () => {
      const stats: Record<string, ModelStats> = {};
      for (const model of MODELS) {
        const st: ModelStats = { calls: 0, invalid: 0, errorsReported: 0, errorsKept: 0, latenciesMs: [], std1: [], std3: [], bandHits: 0, bandTotal: 0, unavailableCorrect: null };
        stats[model] = st;
        for (const f of FIXTURES) {
          const learner = f.transcript.filter((t) => t.who === "user").map((t) => t.text);
          if (f.expectBand === null) {
            const out = await summariseSession(apiKey, { transcript: f.transcript, level: f.level, objectives: f.objectives }, { model, samples: 1 });
            st.unavailableCorrect = out.kind === "unavailable";
            continue;
          }
          const parse = reviewParser(learner);
          const prompt = judgePrompt({ transcript: f.transcript, level: f.level, objectives: f.objectives });
          const cefrs: number[] = [];
          for (let i = 0; i < CALLS_PER_FIXTURE; i++) {
            const t0 = performance.now();
            let raw: Record<string, unknown> | null = null;
            try {
              raw = await generateJson(apiKey, prompt, REVIEW_SCHEMA, record, { model });
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
            try {
              const review = parse(raw, "$");
              st.errorsReported += reported;
              st.errorsKept += review.errors?.length ?? 0;
              cefrs.push(cefrToNum(review.cefr));
            } catch {
              st.invalid++;
              st.errorsReported += reported;
            }
          }
          if (cefrs.length >= 5) {
            st.std1.push(std(cefrs.slice(0, 5)));
            const medians: number[] = [];
            for (let i = 0; i + 3 <= cefrs.length && medians.length < 5; i += 3) medians.push(median(cefrs.slice(i, i + 3)));
            st.std3.push(std(medians));
            st.bandTotal++;
            const band = Math.round(median(cefrs));
            if (Math.abs(band - cefrToNum(f.expectBand)) <= 1) st.bandHits++;
          }
        }
      }

      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
      const rows = MODELS.map((m) => {
        const s = stats[m];
        return {
          model: m,
          invalidRate: s.invalid / Math.max(1, s.calls),
          hitRate: s.errorsReported ? s.errorsKept / s.errorsReported : NaN,
          latency: median(s.latenciesMs),
          std1: avg(s.std1),
          std3: avg(s.std3),
          bands: `${s.bandHits}/${s.bandTotal}`,
          unavailable: s.unavailableCorrect,
        };
      });
      const base = rows[0];
      const cand = rows[1];
      // Screening rules (fixed BEFORE running): the candidate model 晉級 if it is not
      // worse on validity, not worse than 5pp on evidence hit-rate, and not >1.5×
      // slower; 1-sample 晉級 (over 3) if 3 samples do not cut the spread by a full
      // band or more on the baseline model.
      const modelVerdict =
        cand.invalidRate <= base.invalidRate + 0.02 &&
        (Number.isNaN(cand.hitRate) || Number.isNaN(base.hitRate) || cand.hitRate >= base.hitRate - 0.05) &&
        cand.latency <= base.latency * 1.5 &&
        cand.unavailable === true
          ? "晉級"
          : "淘汰";
      const samplesVerdict = base.std1 - base.std3 < 1 ? "晉級（1 次）" : "淘汰（維持 3 次）";

      const lines = [
        `# Judge screening — ${new Date().toISOString().slice(0, 10)}`,
        "",
        `Fixtures: ${FIXTURES.length} synthetic transcripts (src/apps/coach/ai/fixtures/transcripts.ts). Calls per scored fixture per model: ${CALLS_PER_FIXTURE}.`,
        "Vocabulary: screening only —「晉級／淘汰」. Not an evaluation.",
        "",
        "| model | validator failure | error-example hit rate | median latency (ms) | std(cefr) 1 sample | std(cefr) median-of-3 | band within ±1 | coach-only → unavailable |",
        "|---|---|---|---|---|---|---|---|",
        ...rows.map(
          (r) =>
            `| ${r.model} | ${(r.invalidRate * 100).toFixed(1)}% | ${Number.isNaN(r.hitRate) ? "n/a" : (r.hitRate * 100).toFixed(0) + "%"} | ${r.latency.toFixed(0)} | ${r.std1.toFixed(2)} | ${r.std3.toFixed(2)} | ${r.bands} | ${r.unavailable} |`,
        ),
        "",
        `**Text model ${cand.model} vs ${base.model}: ${modelVerdict}.**`,
        `**Judge samples 1 vs 3 (on ${base.model}): ${samplesVerdict}.** (spread reduction ${(base.std1 - base.std3).toFixed(2)} bands)`,
        "",
        "Rules were fixed before the run: candidate 晉級 iff validator failure ≤ baseline+2pp, hit rate ≥ baseline−5pp, latency ≤ 1.5×, coach-only fixture unavailable. 1 sample 晉級 iff median-of-3 reduces the CEFR spread by less than one band.",
      ];
      mkdirSync("docs", { recursive: true });
      writeFileSync(`docs/SCREENING_${new Date().toISOString().slice(0, 10)}.md`, lines.join("\n") + "\n");
      console.log(lines.join("\n"));
      expect(CEFR_LEVELS.length).toBe(6); // the file wrote; the verdicts are in the doc
    },
    20 * 60 * 1000,
  );
});
