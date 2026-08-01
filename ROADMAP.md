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
- **Batch B — pedagogy as prompt logic** (no new API/screen): B1 hands-free
  voice repair (coach treats spoken 「這個怎麼說／慢一點／什麼意思／卡住了」 as
  in-character help and resumes); B2 spaced-review block reshaped to pushed
  output — engineer a slot, elicit the due item UNAIDED, recast only on failure;
  B3 a pre-task planning beat opens every session (名 task in 繁中 + 1–2 chunks,
  then a ~5s 「給你幾秒想一下」 pause before the first question).
- **Batch C — objective-mastery ledger & dependents**: C1 a new IndexedDB
  `objectives` store (DB v3, idempotent v2→v3 upgrade), keyed `scenarioId::objective`,
  aggregating the judge's per-objective verdicts each session (best-effort; no
  cross-scenario identity); its first consumer feeds still-developing objectives
  into the live prompt as priorities. C2 W8 fading scaffold — `scaffoldTier`
  derives model → cue → independent from `srs.reps`, splitting the due-items
  prompt block into those tiers. C3 a can-do self-check in the recap (3-state
  「我可以…」per objective, revealing the judge verdict + a gentle over/under-
  confidence note, folded back into the ledger). C4 a「複習方向」toggle in
  ReviewSheet (認 term→meaning / 用 meaning→term) reusing the same FSRS card.
  The ledger rides in the LearningPack (export + import round-trip) so a backup
  carries the mastery history AND the un-reconstructable self-ratings.
- **Batch A — data safety**: `navigator.storage.persist()` on load (exempts
  IndexedDB from iOS ITP eviction; state shown in ⚙️ as persisted / best-effort /
  unsupported); one-tap 備份資料 in ⚙️ via `navigator.share({files})` with a plain
  `<a download>` fallback (user-initiated, no nag); real PNG icons (192/512 +
  full-bleed maskable + `apple-touch-icon`) so iOS installs get an icon/splash,
  plus workbox runtime-caching of the Google Fonts so the offline shell keeps its
  type (worklet + icons already precached).

- **2026-08-01 — phone-first ease-of-use**: installed PWA opens the coach
  directly (start_url → coach.html; the launcher hop + "coming soon" tiles are
  gone from the daily path); key card gains an AI Studio link + steps and
  validates the pasted key at save time (models.list, zero tokens); a kernel
  error mapper turns the five common failures (key invalid / quota exhausted /
  mic denied / model renamed / network) into ONE 繁中 sentence with the next
  step, wired through Home + Practice including WebSocket close reasons; ⚙️
  gains a live-model override (localStorage) so a Google model rename is
  repairable from the phone without a redeploy.

## Worklist (W1–W7 + Batches A/B/C shipped; D/E below)

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

### Batch V — on-device verification (S; do FIRST — it gates every "completed" claim)
The DoD says "real-browser E2E" but no on-device record exists. One pass on the
actual phone. **Every check is binary (pass/fail) or a number against a fixed
threshold — no free-text observations.** Protocol: one device per platform,
record OS + browser version once; each check gets exactly one row `V# | pass/fail
| measured value (if numeric)` in `docs/DEVICE_E2E.md`.
| # | check | pass criterion (binary/numeric only) |
|---|---|---|
| **V1a** | 乾淨瀏覽器：開 Pages URL → 開口說出第一句，總點擊數 | **≤ 6 次點擊**（含允許麥克風；不含金鑰申請） |
| **V1b** | 同上，總耗時（已持有金鑰） | **≤ 3 分鐘** |
| **V1c** | 金鑰卡的 AI Studio 連結在新分頁開啟 | pass/fail |
| **V1d** | 貼一把壞 key → 儲存被擋下且訊息含「金鑰」二字的繁中句 | pass/fail |
| **V1e** | 貼正確 key → 顯示 ✓ 且金鑰卡消失 | pass/fail |
| **V2a** | 加入主畫面後開啟，首個畫面＝教練 Home（非 Launcher） | pass/fail × Android、iOS 各一 |
| **V2b** | 主畫面圖示為 app 圖示（非瀏覽器預設/空白） | pass/fail × 兩平台 |
| **V2c** | 既有舊安裝不重裝時，start_url 是否更新 | pass/fail（fail＝需重裝，寫進 README 一行） |
| **V3a** | 練習中鎖屏 30 秒→解鎖：session 仍在 live 且 60 秒內完成一次正常對答 | pass/fail |
| **V3b** | 練習中殺分頁→重開：恢復卡出現，且句數 ≥ 殺前句數 − 1 | pass/fail（記兩個數字） |
| **V3c** | 練習中開飛航模式：90 秒內出現繁中錯誤訊息（非英文原文、非無反應） | pass/fail |
| **V4a** | iOS 安裝版連續兩次 session：第二次是否重問麥克風權限 | pass/fail（fail 非缺陷，是事實記錄——決定要不要在 UI 預告） |
| **V4b** | 拒絕麥克風 → 訊息含「麥克風權限被拒」 | pass/fail |
**DoD**: 13 個 check 全數有判定值填入 `docs/DEVICE_E2E.md` → 每個 fail 各開一個
worklist 條目（不當場修）→ commit+push。**任何 check 沒有判定值＝Batch V 未完成。**

### Batch S — 連續情境／故事性 (story arcs; the 2026-08-01 direction update)
誘因＝敘事拉力（想知道下一集），不是 streak/XP — no-schedule-pressure 原則不變：
故事永遠在原地等你，隔一個月回來照樣接得上。全程零後端：prompt 邏輯＋本地狀態。
| # | item | value | guard |
|---|---|---|---|
| **S1** | 故事狀態核心：`Arc`（title、episodes[]、storyState：人物/事件/承諾）新 IndexedDB store＋冪等升版；`finalizeSession` 對 arc 情境多一個 3.5-flash 呼叫生成「下一集」Scenario＋更新 storyState；LearningPack 匯出/匯入 round-trip | 連續性的資料地基；備份帶著故事走 | 生成失敗＝best-effort（arc 停在原集數，隨時可重試）；不新增畫面 |
| **S2** | 單鍵劇集 UX：Home 對進行中 arc 顯示一顆「▶ 下一集 · 第 N 集」（取代該情境的繼續上次）；開場 prompt 加 30 秒繁中「前情提要」beat；集尾自然收束並預告 | 誘因所在 — 打開 app 就是一顆會說故事的按鈕 | one primary action：arc 不得長出列表/儀表板；前情提要 ≤3 句 |
| **S3** | 課綱化 arc：每條 arc 綁一組 CEFR can-do（6–8 個），每集鎖定 1–2 個，餵進 C1 ledger；arc 卡顯示「第 N／約 M 集」一行，不顯示分數 | 「有方法有脈絡」從隱形變可見 | 進度是集數不是百分比（no-gamification 紅線）；can-do 文字固定於 arc 建立時（避免 C1 已知的 objective 漂移） |
| **S4** | 內建示範 arc：EN 一條（多集出差線：機場→客戶會議→危機→應酬）、JA 一條（東京自由行連續劇），沿用 defaults 的 stable-id 機制 | 不用自建就能體驗故事性 | 各 ≤6 集；集與集共用 storyState 種子 |
**Phase order is the dependency order: S1 → S2 → S3 → S4**（S4 可與 S3 併行）。
**DoD per phase**: quality gate green → real-browser E2E of the new behaviour,
**written as binary checks in the Batch-V format**（先在該階段開工前列好
pass criterion，完工時逐條判定，追加進 `docs/DEVICE_E2E.md`；例：S1＝「殺掉生成
呼叫後 arc 集數不變且可重試 pass/fail」、S2＝「Home 到開口說下一集 ≤ 2 次點擊」）
→ update this file → commit & push（push 是每階段最後一步）。

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
**Suggested order:** A, B, C + phone-first ease-of-use shipped. Next: **V**
(on-device verification, small and gating) → **S1–S4** (story arcs — the
current direction) → D (minimal shadowing); E only on demand. Each batch ends
with the full gate + E2E + commit + push.
