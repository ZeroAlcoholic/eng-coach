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
- Quality gate (eslint+tsc+build) wired into CI; black-forest theme.

## Worklist (ordered; each item is independently shippable)

| # | size | item | what / why | minimal-UX treatment |
|---|---|---|---|---|
| **W1** | S | **Per-skill level memory** | EWMA(α≈0.25) per skill on LearnerProfile `{mean,var,history}` — remember & smooth, never overwrite. Foundation for adapting. | Invisible by default; surfaces only as W6's tiny badge. |
| **W2** | S | **Steadier judge** | self-consistency: sample the CEFR judge 2–3×, take the median (cuts run-to-run drift). | Fully invisible. |
| **W3** | M | **Adapt to ability** | client policy table: smoothed level → `{中文比例, 語速, 糾正強度, 鷹架}` rendered into the coach prompt each session (lighten correction as level rises). | Invisible — the coach just "feels right"; at most a one-line「目前模式」hint. |
| **W4** | M | **Anti-stuck help (live)** | 「卡住?」→ 2–3 say-this suggestions (gloss); tap-to-translate a line; ask-in-Mandarin; adjustable speech speed. | ONE small button on the live screen; a sheet opens on demand; speed = a tiny toggle. Orb stays clean. |
| **W5** | S | **UX subtraction — declutter Home** | move 匯出/匯入/CSV/換金鑰 into a single ⚙️ settings sheet; collapse 範例情境 once the user has own scenarios; keep one primary CTA. | This IS the minimalism item — fewer things on screen. |
| **W6** | S | **Glanceable progress** | objectives-met, phrases-used, level trend as small chips / a sparkline. | A single compact strip on Home; no dashboard, no tables. |
| **W7** | M | **FSRS review + warm-up recycle** | ts-fsrs (zero-dep) over LearnedItem; coach weaves due items into the next scene; outcome updates schedule. | A small「複習 N」chip on Home → a 4-button sheet; recycle handled by the coach (no new screen). |
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
**Suggested order:** W5 (declutter first, so new features land on a clean surface)
→ W1 → W2 → W3 → W6 → W4 → W7 → W8 → W9.
