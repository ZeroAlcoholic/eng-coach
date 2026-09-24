# Judge screening — 2026-09-24

Fixtures: 6 synthetic transcripts (src/apps/coach/ai/fixtures/transcripts.ts). Calls per scored fixture per model: 15.
Vocabulary: screening only —「晉級／淘汰」. Not an evaluation.

| model | validator failure | error-example hit rate | median latency (ms) | std(cefr) 1 sample | std(cefr) median-of-3 | band within ±1 | coach-only → unavailable |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash | 29.3% | 100% | 6892 | 0.09 | 0.00 | 5/5 | true |
| gemini-3.8-flash | 1.3% | 100% | 7390 | 0.00 | 0.00 | 5/5 | true |

**Text model gemini-3.8-flash vs gemini-3.5-flash: 晉級.**
**Judge samples 1 vs 3 (on gemini-3.5-flash): 晉級（1 次）.** (spread reduction 0.09 bands)

Rules were fixed before the run: candidate 晉級 iff validator failure ≤ baseline+2pp, hit rate ≥ baseline−5pp, latency ≤ 1.5×, coach-only fixture unavailable. 1 sample 晉級 iff median-of-3 reduces the CEFR spread by less than one band.

## Note — an earlier run the same night (superseded)

A first run used a validator that also voided a sample whenever the model's own
`cefr` label was not exactly a CEFR level (e.g. "B1+"); that check was removed
because the label is derived, not used. Under that stricter validator the table
read 17.3% / 28.0% failures and 3.8-flash was 淘汰. With the shipped validator the
result above stands. Both runs agreed on 1 sample 晉級 and on 100% example hit rate.
Six fixtures are a screen: the 3.5-flash failure rate moved 12pp between runs.
