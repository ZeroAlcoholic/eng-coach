# Judge screening — 2026-09-24

Fixtures: 6 synthetic transcripts (src/apps/coach/ai/fixtures/transcripts.ts). Calls per scored fixture per model: 15.
Vocabulary: screening only —「晉級／淘汰」. Not an evaluation.

| model | validator failure | error-example hit rate | median latency (ms) | std(cefr) 1 sample | std(cefr) median-of-3 | band within ±1 | coach-only → unavailable |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash | 17.3% | 100% | 7735 | 0.00 | 0.12 | 5/5 | true |
| gemini-3.8-flash | 28.0% | 100% | 5792 | 0.00 | 0.00 | 5/5 | true |

**Text model gemini-3.8-flash vs gemini-3.5-flash: 淘汰.**
**Judge samples 1 vs 3 (on gemini-3.5-flash): 晉級（1 次）.** (spread reduction -0.12 bands)

Rules were fixed before the run: candidate 晉級 iff validator failure ≤ baseline+2pp, hit rate ≥ baseline−5pp, latency ≤ 1.5×, coach-only fixture unavailable. 1 sample 晉級 iff median-of-3 reduces the CEFR spread by less than one band.
