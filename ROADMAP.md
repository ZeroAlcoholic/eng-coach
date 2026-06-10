# Worklist — pure-browser voice coach

A single, ordered backlog of shippable work items (hours-of-continuous-dev scale).
Synthesised from a 5-agent research pass, then consolidated under the design
principles below.

## Design principles (apply to EVERY item)
- **極簡 UI**: one primary action per screen; secondary/advanced functions live
  behind a single **settings sheet** or a collapsible row — never on the main
  surface. Default to hidden; reveal on demand (progressive disclosure).
- **輕鬆 UX**: low-friction, glanceable, one-tap; phone- and car-friendly; never
  interrupt the conversation flow. New data (level, progress, review) shows as a
  small badge / mini-trend, **not** a dashboard or a table of numbers.
- **Locked constraints**: no server (GitHub Pages static); all data local-first
  (IndexedDB / localStorage / portable LearningPack); simple architecture —
  everything is prompt logic + local state + the existing `gemini-3.5-flash` calls.

## ✅ Done
- Two-layer scenarios, EN(business)/JA(travel) tracks + built-in defaults; 繁中 UI
  with top EN/日 toggle; live voice (Gemini direct), turn-taking cue, fixed Stop bar.
- **Recap & scoring**: end-of-session LLM-rubric judge → CEFR + per-skill subscores
  (1–6) + wins/fixes + objectivesMet + progressNote (feeds next session); vocab →
  LearnedItem; prompt-first correction; task phases (plan→fluency→accuracy).
- Quality gate (eslint+tsc+vitest+build) wired into CI; black-forest theme.
- **Phone reliability**: screen Wake Lock during sessions (re-acquired on return);
  throttled draft persistence of the live transcript +「恢復上次未儲存的練習」on
  Home (killed tab ≠ lost conversation); honest persist-vs-analysis error split
  (`PersistError`); shared `finalizeSession` pipeline (Practice stop + recovery).
- **Browse your data**: tappable stat chips → 練習紀錄 sheet (past recaps +
  transcripts) and 詞庫 sheet (search + delete);「▶ 繼續上次」one-tap continue.
- **W7 — FSRS review**: ts-fsrs over LearnedItem (serialized card on `srs.fsrs`),
  「複習 N」chip → 4-button sheet (capped stack of 20), due items woven into the
  next live session's prompt (recycle, don't drill).
- **Scenario library v2** (TBLT): EN 9 defaults — meetings (status update,
  defending a position), conference networking, business-trip trouble, business
  dinner; JA 10 defaults — train, directions, shopping, pharmacy + polished food/
  hotel set. Objectives = observable task outcomes; targetPhrases = liftable
  chunks; frames recycle chunks + close with a can-do check.

## Worklist (ordered; each item is independently shippable)

| # | size | item | what / why | minimal-UX treatment |
|---|---|---|---|---|
| ~~W1–W7~~ | — | **shipped** — see ✅ Done above. | | |
| **W8** | M | **Scaffolding that fades** | per-item mastery: full model → leading cue → independent; drives the A2→production move. | Invisible; just changes how much the coach hands you. |
| **W9** | M | **Shadow micro-mode (prosody)** | optional「跟讀」: coach models a phrase, you echo, qualitative stress/rhythm feedback (intelligibility, not an accent score). | A small optional affordance inside a turn; off the critical path. |

## Later / optional (only if a real need shows)
- Spoken placement (1–2 min) → per-skill CEFR + goal; SSARC complexity ramp on the
  Layer-1 frame; Bayesian Knowledge Tracing per objective; deterministic lexical
  metrics (type-token / frequency bands, JLPT list) as a 2nd opinion to the judge.

## Deliberately NOT building (lean, no-server)
No backend; no ELSA-style phoneme/calibrated pronunciation score (needs a server
acoustic model); no IRT/CAT placement machinery; no streaks/XP/leaderboards
(erodes intrinsic motivation for a solo learner); no FSRS optimizer < 1000 reviews.

---
**Suggested order:** W8 → W9 (W1–W7 shipped).
