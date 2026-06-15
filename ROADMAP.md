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
- **No schedule pressure**: usage is deliberately irregular. Build NO reminders,
  "due now" nudges, "you've been away" prompts, streaks, or time-based nags. The
  app must feel identical whether opened daily or once a month — value is there
  when picked up, never demanded. FSRS already tolerates this: due items just
  surface most-overdue-first when you happen to practise, with no penalty.

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

## Worklist (W1–W7 shipped; W8+ below)

Synthesised from a 6-dimension research pass (vocab depth, learner memory,
prosody, live scaffolding, learning theory, PWA/UX), then **verified twice**
against this codebase and the no-server / mobile / no-gamification constraints.
Items proven fragile or low-value were cut or deferred (see "Deliberately NOT
building" and "Deferred — needs a missing precondition" below).

**Definition of done — applies to EVERY batch:** quality gate green
(`tsc -b` + `eslint` + `vitest run` + `vite build`) → real-browser E2E of the
new behaviour (seed IndexedDB, exercise the flow, clear test data) → update this
file → **commit & push** (CI re-runs the gate, then auto-deploys to Pages). Push
is the last step of each batch, never mid-batch.

### Batch A — data safety (do first; all S; one PR; no new data shapes)
*Local data can be silently evicted (iOS ITP). These three are independent.
No reminder/nudge mechanics — see the "no schedule pressure" principle above.*

| # | item | value | stability | files / mechanism |
|---|---|---|---|---|
| **A1** | `navigator.storage.persist()` on load; show state in ⚙️ | exempts IndexedDB from iOS ITP 7-day eviction | high (Baseline 2021 / Safari 17+) | `CoachApp` mount + `Home` settings |
| **A2** | One-tap backup via `navigator.share({files})`, always available in ⚙️ | frictionless save to NAS/Files when the user chooses | high (iOS 16.4+/Android); desktop adds FSA later | `pack.ts`, `Home` ⚙️; feature-detect, fall back to existing `<a download>`. **No time-based "N days since backup" nag** — user-initiated only |
| **A3** | PWA shell fix: 192/512 + maskable **PNG** icons, `apple-touch-icon`; verify precache covers worklet + fonts | offline Home/review/history in-car; real iOS icon/splash | high | `vite.config.ts` manifest, `public/` (iOS ignores SVG icons) |

### Batch B — pedagogy as prompt logic (all S; zero new API, zero new screen)
*Lowest-risk, highest minimal-UI fit: changes the coach's behaviour, not the UI.*

| # | item | value | guard |
|---|---|---|---|
| **B1** | Voice-invoked repair: coach treats「這個怎麼說 / 慢一點 / 什麼意思」as in-character help | hands-free repair (car); replaces tap-only 卡住/translate | prompt-only; test mixed-language ASR of the trigger phrases |
| **B2** | Pushed output on due items: engineer a slot, make the learner **produce unaided**, recast only on failure | testing effect (recall ≫ recognition) | "produced unaided" comes from the judge re-reading the transcript → treat as a **best-effort soft signal**, not ground truth |
| **B3** | Pre-task planning beat: name the task in 繁中 + 1–2 chunks, then a 5–8s "想一下" pause before the first question | documented fluency/complexity gain | prompt-only; pure audio |

### Batch C — objective-mastery ledger & its dependents (M)
*C1 is the keystone; C2–C4 read from it.*

| # | item | value | stability / dependency |
|---|---|---|---|
| **C1** | **Per-objective mastery ledger.** `objectivesMet` is **already stored on every session record** (`finalize` → `putSession({...session, review})`) but not queryable per objective. Aggregate it into a new IndexedDB `objectives` store keyed by `scenarioId + objective`. | unlocks C2–C4 | new store; **no cross-scenario matching** (objective text has no stable identity across regenerated scenarios) |
| **C2** | **W8 — fading scaffold.** Derive a per-item tier (full model → leading cue → independent) and inject it into the due-items prompt block. | the A2→production driver; fully invisible | tier derives from the item's existing `srs.reps` / `srs.fsrs.state` (no new state). **Honest limit:** `reps` counts *flashcard* gradings, not unaided speech — start with reps as a coarse proxy, refine with B2's production signal |
| **C3** | can-do self-check in recap: objectives as 3-state「我可以…」toggles; compare to the judge's `objectivesMet` → the gap is the calibration signal, feeds C1 | metacognition + SDT competence **without** gamification | one list in the existing recap sheet, not a new screen |
| **C4** | Productive-direction review: a「複習方向」toggle in `ReviewSheet` (L1→L2 recall), reusing the same FSRS card | closes the "recognise-only" gap | flip front/back; do **not** double the schedule |

### Batch D — minimal shadowing (the stable core of W9; M)
| # | item | value | guard |
|---|---|---|---|
| **D1** | 跟讀 = coach models a phrase → learner records (MediaRecorder) → **A/B replay** (your clip ↔ coach clip) | self-comparison rebuilds prosody; rock-solid APIs | **no analysis, no score** (holds the ROADMAP line). Cost to scope: capturing the coach's modeled phrase needs a small playback-buffer tap in `AudioEngine` |

### Batch E — optional, only if a real need shows
- **E1** LLM error-log extraction (fixed error-type enum to bound noise) — extra Gemini call/session.
- **E2** RMS stress/energy envelope viz — loudness ≠ stress; risks cluttering the clean orb.
- **E3** LLM cloze cards + collocations/word-families — distractor quality ~50%; adds review-mode complexity; not the "speak more" core.

## Deferred — needs a missing precondition
- **Cross-scenario objective scheduler (interleaving across scenarios)** — needs a stable objective-identity / tagging scheme; objective free-text doesn't match across regenerated scenarios. Build C1's ledger first.
- **Pitch-contour overlay & Gemini "spoken impression"** — phone-mic F0 is noisy (compare *shape* only, needs voiced-gating + smoothing); the LLM note is an *impression, not a score*. Experimental add-ons on top of D1, not core.
- **Bayesian Knowledge Tracing** — Bayesian updates on the judge's noisy binary signal are precision-as-illusion; marginal value over EWMA + C1's ledger is low.
- **Frequency/coverage % meter** — needs lemmatisation (hard for JP); a coverage % is effectively a score (conflicts with no-gamification). At most an approximate band tag, never a number claim.
- Spoken placement test; SSARC complexity ramp (gate stage-3 behind B1+ — pushing beginners raises anxiety).

## Deliberately NOT building (lean, no-server)
No backend; no ELSA-style phoneme/calibrated pronunciation score (needs a server
acoustic model); no IRT/CAT placement machinery; no streaks/XP/leaderboards
(erodes intrinsic motivation for a solo learner); no FSRS optimizer < 1000
reviews; no Web Push / Periodic Background Sync / Notification Triggers (server-
bound or unsupported on iOS — and unwanted regardless: no reminders/nudges per
the no-schedule-pressure principle); no WASM forced alignment (too heavy for
mobile).

---
**Suggested order:** A → B → C → D; E only on demand. A and B are all-S and touch
no existing data shapes; C introduces the first new store. Each batch ends with
the full gate + E2E + commit + push.
