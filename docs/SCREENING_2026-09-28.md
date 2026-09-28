# Judge screening — 2026-09-28

Model: gemini-3.8-flash (the shipped judge). Fixtures: 6 synthetic transcripts (src/apps/coach/ai/fixtures/transcripts.ts), 5 calls per scored fixture, 26 calls in all.
Vocabulary: screening only —「晉級／淘汰」. Not an evaluation.

| validator failure | error-example hit rate | type recall | band within ±1 | coach-only → unavailable | mixed objective NOT met | l1Fallbacks.said hit rate | median latency (ms) |
|---|---|---|---|---|---|---|---|
| 0.0% | 100% | 2/3 | 5/5 | true | 10/10 | 20/20 | 7946 |

| fixture | median band | error types reported | code-mixing | note |
|---|---|---|---|---|
| en-a2-hotel | 2 (期望 2) | tense,plural,preposition,particle,article (期望 tense,article) | — | — |
| en-b2-negotiation | 5 (期望 4) | — (期望 —) | — | — |
| ja-a1-ramen | 1 (期望 1) | wordChoice (期望 particle) | — | — |
| coach-only | — | — | — | unavailable=true |
| en-mixed | 1 (期望 2) | politeness (期望 —) | 5/5 not met；fallback 10/10 | — |
| ja-mixed | 1 (期望 1) | particle,politeness (期望 —) | 5/5 not met；fallback 10/10 | — |

**gemini-3.8-flash on the Phase D/E prompt rules: 晉級.**

Rules were fixed before the run: validator failure ≤ 5%, example hit rate ≥ 90%, type recall ≥ 50%, coach-only unavailable, Chinese-completed objective graded not met in ≥ 80% of calls (U6), reported l1Fallbacks.said real substrings in ≥ 80%.
If 淘汰 on the code-mixing rule: the fallback is a program-side rule (an objective whose text matches an l1Fallbacks.target is forced not met), not a new field — see docs/BLUEPRINT_2026-09-28.md U6.

## Note — the first run the same day (rules allow one rerun of a failed check)

The first run read type recall **1/3** (hotel: tense hit, article missed; ramen:
particle missed) with every other column identical (0.0% / 100% / 5/5 / true /
10/10 / 20/20), so the verdict was 淘汰 on that one column. The rerun above read
2/3 → 晉級. Three expected types are too few to separate the judge from noise on
recall; the columns this screening was added for (the code-mixing not-met rule
and the l1Fallbacks substring rule) read 10/10 and 20/20 in BOTH runs. Both
tables are kept verbatim under `.synthetic-cache/SCREENING_run1.md` / `_run2.md`
on the dev machine (not committed). Cost: 2 × 26 calls to gemini-3.8-flash.

