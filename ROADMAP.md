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

- **2026-08-01 — V-desktop 跑完 + Batch S 的 S1／S2 出貨**: V-desktop 6 項判定值
  全部填入 `docs/DEVICE_E2E.md`（V1a′ 5 次點擊、V1c／V1d／V1e pass、V3c 1 秒；
  V3b blocked — 開發機無任何實體麥克風，已附兩條替代路徑的探針證據）。
  **S1** — `Arc`／`StoryState`／`ArcEpisode` 型別 + IndexedDB v4 `arcs` store
  （v3→v4 冪等升版）；`arcs.ts` 擁有三條不變量：同時只有一個 pending 集、集與其
  Scenario **同一個 transaction 原子寫入**、advanceArc 冪等且 single-flight。集尾在
  `finalizeSession` 以 best-effort 多打一次 3.5-flash 生成下一集並改寫 storyState，
  失敗時 arc byte-identical、下次點「下一集」即為重試。arc 隨 LearningPack 匯出／
  匯入（單情境 pack 也夾帶所屬 arc）。**S2** — Home 對進行中 arc 只長出**一顆**
  「▶ 下一集 · 第 N 集」（取代該情境的繼續上次，集數而非百分比；其餘故事線收在一顆
  「其他故事線（N）」ghost 後，不長列表）；live prompt 加開場順序＝前情提要（≤3 句，
  程式層 clamp）→ planning beat →進角色，並帶入人物／已發生事件／未解懸念與集尾
  收束＋下一集預告；新增區多一個「連續劇」勾選作為建立入口。

- **2026-08-01 — S4／S3／D1 出貨（Batch S 完成、Batch D 完成）**:
  **S4** 內建示範劇集，EN「倫敦出差：從入境到應酬」＋ JA「東京自由行：五天連續劇」，
  各 6 集。只有第 1 集是授撰的 → 安裝**零 API 呼叫、離線可用**；第 2 集起走正常生成
  路徑，並由新的 `Arc.outline`（每集一段 beat）把故事鎖在設計好的形狀上（機場→對接→
  客戶會議→危機→協商→應酬），同時仍會依實際逐字稿改寫 storyState。stable id 沿用
  DEFAULT_SCENARIOS 機制（重覆安裝覆寫而非新增）。授撰資料由 16 個單元測試把關，含
  一道**簡體字**檢查。
  **S3** 每條 arc 綁 6–8 個 CEFR can-do，`ArcCanDo` 文字在建立時凍結（模型只能用
  1-based index 挑，越界／重複／非整數一律丟棄）。can-do 併入該集 scenario 的
  objectives，因此直接沿用既有的 live prompt 引導＋集尾判決，不另建一套機制；判決除了
  寫進 episode 自己的 C1 列，還以 **arc id** 為 key 再寫一次 —— 這是讓 mastery 能跨集
  累積的唯一辦法（每集都是新 scenario，用 scenario key 永遠停在 attempts=1），也是
  ROADMAP「Deferred — cross-scenario scheduler」所缺的穩定 objective identity 在 arc
  範圍內合法成立的地方。Practice 同時吃 episode 層與 arc 層的弱項。arc 卡多一行
  「◦ 這集練：…」，進度仍只有集數。
  **D1** 最小跟讀：`AudioEngine` 新增按輪擷取教練音訊（barge-in 打斷的半句丟棄、單輪
  上限 30 秒），`encodeWav` 把 provider PCM 包成 WAV，暫停狀態出現「🔁 跟讀」面板 ——
  錄自己一段、A/B 兩顆大按鈕來回比對，**不打分數、不做分析**。只在暫停時提供是刻意的：
  live 時麥克風正在串給 Gemini，跟讀會被當成一句話回應。
  **E2E 抓到並修掉兩個真缺陷**：(1) `coach.html` 的 CSP 缺 `media-src`，`blob:` 音訊被
  Chrome 擋掉 → 跟讀重播在正式環境會完全失效；(2) `describeError` 漏
  `OverconstrainedError`（拔掉耳麥／找不到裝置）會漏成英文原文。

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

### Batch V — verification（拆成兩半：桌機可代跑 / 必須手機）
**Status: V-desktop 可由開發端隨時執行；V-phone deferred（附因：使用者暫不想
親自實測，2026-08-01）— 不阻擋 Batch S/D 開工，但在 V-phone 補齊前，任何
batch 不得宣稱「手機端已驗證」。**
**Every check is binary (pass/fail) or a number against a fixed
threshold — no free-text observations.** Protocol: one device per platform,
record OS + browser version once; each check gets exactly one row `V# | pass/fail
| measured value (if numeric)` in `docs/DEVICE_E2E.md`.

**V-desktop（桌機瀏覽器可判定，開發端代跑）**: ✅ 2026-08-01 跑完 — V1a′ 5 次點擊、
V1c／V1d／V1e pass、V3c 1 秒；**V3b blocked**（開發機無實體麥克風，唯一擷取裝置是
立體聲混音且回錄路徑實測靜音 → 對話恆為 0 句，無法量「殺前句數」）。V3b 與 S2b-ii
共用同一個解鎖條件：**插上任一 USB 麥克風／耳麥**後各跑一次即可補判定。
**V-phone（只能實機，暫緩）**: V1b、V2a–V2c、V3a、V4a–V4b。
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
**Status: S1 ✅ / S2 ✅ / S3 ✅ / S4 ✅ — Batch S 完成（2026-08-01）。**
仍然成立的取捨（不是待辦，是刻意的邊界）：
- 一次只有一條 arc 是主按鈕；其餘收在「其他故事線（N）」後面。內建兩條落在不同語言，
  不會互相擠壓。
- 集尾生成在 `finalizeSession` 內 await，會讓「分析中…」多幾秒（實測 ~19 秒含判決）。
  若覺得太久，改成不 await（Home 的「下一集」本來就會等同一個 in-flight promise）。
- `plannedEpisodes` 固定 6（`DEFAULT_ARC_LENGTH`），沒讓模型決定長度。
- arc 走完 6 集後卡片消失（`isArcFinished`），目前沒有「重看／重練這條故事」的入口。
**Phase order is the dependency order: S1 → S2 → S3 → S4**（S4 可與 S3 併行）。
**DoD per phase**: quality gate green → real-browser E2E of the new behaviour,
**written as binary checks in the Batch-V format**（先在該階段開工前列好
pass criterion，完工時逐條判定，追加進 `docs/DEVICE_E2E.md`；例：S1＝「殺掉生成
呼叫後 arc 集數不變且可重試 pass/fail」、S2＝「Home 到開口說下一集 ≤ 2 次點擊」）
→ update this file → commit & push（push 是每階段最後一步）。

### Batch D — minimal shadowing (the stable core of W9; M)
**Status: D1 ✅ 2026-08-01**（判定見 `docs/DEVICE_E2E.md`；D1a-ii 待麥克風補判定）
| # | item | value | guard |
|---|---|---|---|
| **D1** | 跟讀 = coach models a phrase → learner records (MediaRecorder) → **A/B replay** (your clip ↔ coach clip) | self-comparison rebuilds prosody; rock-solid APIs | **no analysis, no score** (holds the ROADMAP line). Cost to scope: capturing the coach's modeled phrase needs a small playback-buffer tap in `AudioEngine` |
實作備註：擷取點在 `AudioEngine.playPcm`，以「輪」為單位（`beginCoachTurn` /
`endCoachTurn`，由 transport 的 turn state 驅動）；barge-in 打斷的半句丟棄，單輪上限
30 秒。面板只在**暫停**時出現 —— live 時麥克風正串給 Gemini，跟讀會被當成一句回應。

### Batch E — ✅ 2026-08-01（使用者明確要求做完；每一項都用設計避開它自己記的疑慮）
- **E1** ✅ 錯誤型態帳本，closed enum（`ERROR_TYPES`，10 種，含 JA 的助詞／敬語）。
  **沒有多打一次 API**：掛在既有判決呼叫上，而既有的 3 次 self-consistency 取樣正好是
  E1 要的壓雜訊機制——型態需在多數取樣出現才計入。`count` 計 **session** 不計次數；
  ≥2 個 session 才算「常犯」，然後以繁中名稱＋學習者原句＋自然說法進 live prompt。
- **E2** ✅ 音量指示，**預設關閉**、不碰 orb。疑慮是「音量 ≠ 重音」，所以它就叫音量，
  畫面永遠寫「這是音量，不是重音也不是分數」，真正用途是回答「麥克風有沒有收到我」。
  RMS 從既有的擷取 frame 算（無新增音訊節點），~10Hz 節流，關閉時完全不算。
- **E3** ✅ 填空複習＋搭配詞，**完全不生成選項**——疑慮是干擾項品質約 50%，所以直接
  繞開：回想後自評，沿用同一張 FSRS 卡（認／用／填空是三種提示、一個排程）。填空優先
  由**純函式**從該詞自己的例句挖空（零 API、離線可用、品質最高）；只有例句不含該詞時
  才呼叫模型，結果連同搭配詞快取在 item 上並隨 LearningPack 走。
  快取出題會被驗證（必須含空格、不得含答案），答案的**每一次**出現都會被遮住。

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
**Where things stand (2026-08-01).** Shipped: W1–W7, Batches A/B/C, phone-first
ease-of-use, **V-desktop**, **Batch S (S1–S4)**, **Batch D (D1)**, **Batch E
(E1–E3)**. The whole worklist is now built. A four-reviewer code-review pass over
everything from S1 onward found and fixed 13 real defects — four of which broke a
feature outright for real users (shadowing played the wrong turn; a review-sheet
effect billed the API in an unbounded loop; an episode pack restored an arc that
could never continue; the ≤3-sentence recap guard never fired on English prose).
The findings and fixes are itemised in `docs/DEVICE_E2E.md`.

**Two verification debts, both waiting on hardware, neither blocking:**
1. **A microphone on the dev machine** unblocks three already-registered checks —
   `V3b` (kill-tab → recovery sentence count), `S2b-ii` (recap IS the first coach
   turn), `D1a-ii` (the shadowed clip comes from a real coach turn). This desktop
   has no capture device at all (only a silent Stereo Mix loopback), so a live
   session never accumulates turns. Any USB mic/headset clears all three.
2. **V-phone** (9 checks) needs the user's own phone for 15 minutes. Until it is
   done, **nothing may claim「手機端已驗證」— only「桌機已驗證」**, and even on
   desktop the three checks above are still open.
