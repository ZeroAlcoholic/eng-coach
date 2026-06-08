# Roadmap — pure-browser voice coach

**Definition of "long-term":** an hours-of-continuous-dev backlog of concrete,
shippable increments. **Locked constraints:** no server (GitHub Pages static),
all data local-first (IndexedDB / localStorage / portable LearningPack), simple
architecture — everything below is prompt logic + local state + the
`gemini-3.5-flash` calls already in the pipeline. Synthesised from a 5-agent
web research pass (apps + SLA pedagogy + curriculum + assessment/adaptivity).

## Phase 0 — Close the learning loop (the missing payload) · P0
- **Richer end-of-session recap**: one `gemini-3.5-flash` call → `{cefr, subscores{grammar,vocab,fluency,interaction}, wins[], fixes[], reformulations[], objectivesMet[], reviewZh, progressNote}`; persist on `SessionRecord`, show in the done card, emit `LearnedItem` rows. *(extends current `summariseSession` + `extractLearnedItems`.)*
- **Feedback decision-tree (prompt-first)**: on error, PROMPT for self-repair first; explicit/metalinguistic only if they can't fix it after one try; type-by-error; cap per turn. *(Research: prompts give the most durable gains; default-recast is the weakest option.)*
- **Pushed-output core policy**: short coach turns, learner talk-time ≥60%, end most turns with a produce-request, pre-surface the gap for the A2 JA learner. *(mostly already in the prompt — reinforce.)*
- **Task-bounded sessions**: drive toward the scenario's 2–3 objectives; PLANNING → FLUENCY (withhold correction) → ACCURACY (revisit 1–2 errors) phases; wrap up when objectives are met.

## Phase 1 — Remember & adapt · P0
- **LLM-as-rubric judge** (rubric + few-shot anchors + reason-before-number + median of 2–3): per-session CEFR + per-skill subscores. *(reuse the recap call.)*
- **Per-skill level state** on `LearnerProfile` `{estimateMean, estimateVar, history[]}`, EWMA (α≈0.25) — never overwrite; render a progress chart.
- **Adaptivity policy table**: smoothed level + subscores → `{l1Ratio, speechRate, lexicalCeiling, correctionMode, scaffoldStyle}` rendered into the coach prompt each session (expertise-reversal: lighten correction as level rises).
- **Anti-stuck UX**: "help me" suggestions, tap-to-translate, ask-in-Mandarin, adjustable speech speed (`playbackRate`); persist preferences.

## Phase 2 — Real review & contextual recall · P0/P1
- **ts-fsrs over LearnedItem** (zero-dep, client-side) + 4-button post-session review; keep Anki-CSV aligned; FSRS defaults (no optimizer < 1000 reviews).
- **Live recycle + Pimsleur anticipation**: warm-up surfaces due items; coach elicits them in a fresh scene; outcome updates the FSRS schedule.
- **Scaffolding-then-fading** tied to per-item mastery (full scaffold → leading cue → independent).
- **Intrinsic progress counters** (objectives met, phrases used, recall hit-rate). No streaks/XP.

## Phase 3 — Curriculum depth & placement · P1/P2
- **Optional spoken placement** (1–2 min Live + comprehension probes) → per-skill CEFR + goal/interests.
- **Target-situation inventories** per track (editable JSON) → deficiency-based scenario generation.
- **SSARC complexity dials** on the Layer-1 frame; re-run the same frame harder with fresh Layer-2 content.
- **Bayesian Knowledge Tracing** per objective (productive mastery), retire mastered, surface weak.

## Phase 4 — Pronunciation (scope honestly) · P1/P2
- **Shadow micro-mode** with qualitative prosody/comprehensibility feedback (intelligibility, not accent elimination).
- **Optional Gemini-multimodal** word-level stress/mispronunciation flags + red highlight + "hear it" — coaching guidance, NOT a calibrated score.
- **Deterministic lexical metrics** (type-token + frequency bands; JLPT list for JA) to stabilise the level estimate.

## Deliberately NOT building (lean, no-server)
No backend; no ELSA-style phoneme alignment / calibrated pronunciation score
(needs a server acoustic model); no IRT/CAT placement machinery (only pays off at
many-user scale); no streaks/XP/leaderboards; no FSRS optimizer < 1000 reviews.
