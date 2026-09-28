# eng-coach 藍圖 v4（2026-09-28）— 三階段、每階段一句 GOAL

基準：`main` HEAD `90ad1e5`；baseline **vitest 249/249 ✓、1 skipped（screening）**（2026-09-28 實跑）。
前置：`docs/BLUEPRINT_2026-09-24.md`（v3，Phase A／B／C 已出貨）與本日三輪診斷。本文件取代 v3 的 §5 後續。

## 0. 已查證事實（每條有探針）

| 事實 | 探針 |
|---|---|
| 線上 `coach.html` 200，引用 `coach-Dsh_BBiI.js` 與本機 dist 同 hash；dist 無 `AIza` | curl＋grep 實跑 |
| 微 session 只進讀數 b：`readouts.judgedSessions` 排除 `kind==="micro"`，且微 session 不跑 judge | `readouts.ts:62`、`finalize.ts:165–169` |
| 90 秒只在 prompt，程式無計時器 | grep `setTimeout` 於 Practice／session 只有草稿計時 |
| `aids` 為 session 級計數，非 turn 級 | `types.ts:238`、`Practice.tsx:105` |
| 微 session 的 prompt 仍帶 due items／弱目標／連續劇段 | `Practice.tsx:313` 傳完整參數 |
| prompt 要求教練「重組後請學習者說回」；judge 只讀 learner turns，無回聲辨識 | `prompt.ts:183`、`review.ts:150`；grep echo 零命中 |
| prompt 鼓勵口說求助；`aidsRef` 只數按鈕 | `prompt.ts:130–136`、`Practice.tsx:347,398` |
| `SessionRecord.focus` 存顯示字串，非結構 | `Practice.tsx:432` 傳 `describeFocus(...)` |
| screening 從未比對 fixture 的 `expectErrorTypes` | grep 於 src 只在 fixtures 定義 |
| `TranscriptTurn` 無時間戳 | `types.ts:193` |
| grammar 項目只有 `text`，`uses.ts` 整串子字串比對 | `items.ts:40`、`uses.ts:23` |
| judge 丟棄 pronunciation；教練場上的發音回饋無紀錄 | `review.ts:79`；review 無此欄位 |
| prompt 每回合要求口音回饋，與「fluency 階段默記」矛盾 | `prompt.ts:126` vs `:128` |
| prompt 的 code-switch 全指教練自己的混用；學習者「句中夾中文」在 prompt／judge／抽詞／焦點皆無處理 | grep `mix`／`fragments`／`fallback` 只命中教練段 |
| Node 與現代瀏覽器支援 `\p{Script=Han}`／`Hiragana`／`Katakana` | node 實跑 true |
| CSP 存在、`script-src 'self'`、無 innerHTML／eval；`connect-src https: wss:` 過寬 | `coach.html:12`；grep 零命中 |
| SW 只快取字型 | `vite.config.ts:64–78` |
| `finalize.ts:130` 註解仍寫三次取樣，實際預設 1 | 原文 vs `overrides.ts` |
| session owner 以 `createAudio(callbacks)` 注入音訊；`SessionAudio` 介面 13 個方法 | `session.ts:60–86` |
| transport 只用 `btoa`／`atob`／WebSocket，Node 22.20 原生具備 | grep 瀏覽器全域零命中 |
| 本 key 可見 `gemini-3.8-flash-tts`（generateContent）、`gemini-3.8-live`（bidi） | `models.list` 零 token 實跑 |
| vitest 環境為 node；finalize 全部相依可注入（記憶體） | `vitest.config.ts:5`、`finalize.ts:82` |

推論：回聲與口說求助對 CEFR／can-do 的膨脹幅度，只能在真實或合成逐字稿上量。

## 1. 不變量（承 v3，新增兩條）

零後端／BYOK／IndexedDB＋LearningPack。不加狀態機套件、DI、bus、多供應商抽象、function-call 工具群、schema 編譯器、Playwright。無 streak／提醒。每項改動能陳述「改動→行為差異→結果動，因為[機制]」。範圍外發現只登錄不動手。
- **新增**：不新增任何量測用 API 呼叫；量測全由純函式從既有紀錄推出。
- **新增**：合成學習者是**腳本化**的固定台詞，不是 LLM 驅動的代理；每次執行有硬上限（台詞數、分鐘數）由程式斷言，執行前印估價後**直接跑完**，不停下請示（2026-09-28 使用者裁決）。TTS 用 `gemini-3.8-flash-lite-tts`；judge 與 Live 用出貨模型；永不呼叫 pro／extended-thinking／其他模型。

## 2. 相依性

```
Phase D 量測誠實                 Phase E 口音與句型
  D1 turn 註記（echo／aided／l1）   E1＋E4 prompt 校準與夾雜輔導（獨立，同一 PR）
   ├─ D2 judge 標記＋l1Fallbacks ── E2 pronunciationNotes（與 D2 同一次改 judge）
   ├─ D6 chunkUse 分母（分子靠 D1）─ E3 grammar frame（分子靠 D1）
  D4 結構化焦點 ─ D5 焦點解決率 ─── E5 焦點 kind "gap"（靠 D2、D4）
  H2 screening 在 D2 合併後跑一次（U6 的讀數）
  D3 微 prompt 收斂、D8 安全網（獨立）
            ╲                       ╱
             Phase F 合成學習者 — 驗證 D、E 在真實 ASR 逐字稿上的行為；
             解鎖 v3 標 blocked 的 Chrome 替身以外檢查
```

D、E 可平行（各開分支；共用 `kernel/types.ts` 擴充時 D1 先合）。F 的 harness（F1）不依賴 D、E，可先做；F 的判定（F3）在 D、E 合併後跑。

## 3. 三句 GOAL

### Phase D — 量測誠實

> **讓 Home 的三個讀數與 judge 的 CEFR，只反映學習者「自發、未受助」的產出；讓每一個焦點都能在之後的正式 session 被量到有沒有解決。**
> 做法邊界：一切為純函式讀既有逐字稿；judge prompt 只加標記與指示，不加欄位（E2 除外）；舊紀錄無註記時視為 unknown 不進分母，與 `aids` 缺席同規則。

### Phase E — 口音與句型

> **讓教練場上有聲學依據的口音回饋能被記住並在下一場延續；讓有槽位的句型在學習者換了填充詞後仍被認出是「用出來」。**
> 做法邊界：口音只留筆記不留分數、不進 ErrorType、不進讀數、不進 EWMA；句型只用錨點依序比對，不接受模型產生的 regex；不做音素評分、音高曲線、文法分類體系。

### Phase F — 合成學習者

> **在沒有麥克風與人類的情況下，讓 v3 標為 blocked 的生命週期與學習迴圈檢查，能對真實 `gemini-3.8-live` 跑出二元判定。**
> 做法邊界：`SyntheticLearnerAudio implements SessionAudio`，以 `createAudio` 注入，不碰 `AudioEngine`／`gemini-direct`；台詞以 `gemini-3.8-flash-tts` 事前合成並快取在 gitignored 目錄，重跑零 TTS 費用；每回合等 owner 的 cue 轉為「you」才送下一句，送完補靜音；教練 PCM 收進緩衝，`onDrained` 以 PCM 長度換算時間後觸發。用詞新增一級「**合成已驗證**」，介於「桌機替身」與「真機」之間；它證明協定、生命週期與 pipeline 在真實音訊上成立，**不證明**手機 UX、麥克風授權流程、或教學法對人有效。

## 4. 工作清單（二元判定；vitest／合成／Chrome 替身／真機）

### Phase D

| # | 改動 | 相依 | 判定 |
|---|---|---|---|
| D1 | `TranscriptTurn` 加選填 `echo?: true`、`aided?: true`、`l1?: true`；純函式 `annotateTurns(transcript, language, aidedTurnIdx)`：回聲＝學習者 turn 的 token 覆蓋率 ≥0.8 落在前一 coach turn（en ≥3 詞、ja ≥6 字）；口說求助＝learner turn 命中 `HELP_TRIGGERS`（從 `prompt.ts` 匯出的單一常數），標記落在其後下一個 learner turn；**l1**＝en 情境下 learner turn 含 `\p{Script=Han}`／假名（句中夾雜或整句中文皆算，代表該 turn 不是目標語產出）；ja 情境無法靠字集判斷，`l1` 由 D2 的 judge 欄位回填；Practice 按鈕改記 `turnsRef.current.length` 進 `aidedTurnIdx` | 無 | 六份 screening fixture 零誤標；新增四份 fixture（回聲、口說求助、en 夾中文、ja 夾中文）各標對；`aidedTurnIdx` 為空時舊行為不變；ja 情境純函式永不標 `l1` |
| D2 | judge prompt：echo turn 前綴 `[repeated after coach]`、l1 turn 前綴 `[contains Chinese]`，兩者皆不作 can-do 證據；**新規則：objective 只有在完全以目標語完成時才 met，靠中文詞完成＝not met**；新欄 `l1Fallbacks: {said, target}[]`（≤5，`said` 須為 learner turn 子字串，ja 情境以此回填 `l1`）；全為回聲或全為中文→`unavailable`；`uses.ts` 與讀數 a 排除 echo／aided／l1 turn | D1 | 純回聲 fixture 回 unavailable；手算 a 值與排除後相符；`uses` 對 model 層複誦不計；en 夾中文 fixture 的 `l1Fallbacks.said` 全為子字串、捏造者被丟；該 fixture 以中文詞完成的 objective 判 not met（此條需下次付費 screening 確認模型遵從，H2） |
| D3 | 微 session 呼叫 `composeSystemInstruction` 時 dueItems、weakObjectives、arc 傳空 | 無 | prompt.test 斷言微 session 指令不含「Spaced review」「still aren't solid」「連續劇」 |
| D4 | finalize 於 `applyReview` 後以 fresh profile 算 `pickFocus`，結構化存進正式 session 的 `focus: Focus`；微 session 存 `drilledFocus: { sourceSessionId }`；Practice 的 FocusCard 改讀 outcome | 無 | finalize.test：同 session 重跑 focus 只寫一次；舊紀錄 focus 為字串時讀數視為 unknown |
| D5 | 讀數 c 改為焦點解決率：焦點型別在之後兩場正式 session 的 `review.errors` 未再出現即解決；來源列表分「有練／沒練」 | D4 | 0／1／5+ 場 fixture 手算相符；後續不足兩場時 value 為 null |
| D6 | Practice 把 `dueItems` 的 id 傳入 finalize，`SessionRecord.recycled: string[]`；讀數 b 分母＝視窗內各場 recycled 之和，分子＝非回聲使用 | D1（分子） | fixture：三個 recycled、一個非回聲使用→1/3；舊紀錄無 `recycled` 不進分母 |
| D7 | `finalize.ts:130` 註解改為一次取樣；Home 抽出 `Readouts.tsx`（只搬不改） | 隨 D5 觸碰時 | vitest 全綠；Home 行數下降 |
| D8 | 微 session 120 秒安全網走既有 Stop 路徑；prompt 仍要求 90 秒收尾 | 無 | vitest 假時鐘：120 秒後 phase 進 stopping；Chrome 替身：非微 session 無此計時器 |

### Phase E

| # | 改動 | 相依 | 判定 |
|---|---|---|---|
| E1 | prompt：口音回饋改為「阻礙理解或同一音重複時才給，三到四回合至多一次，從閉集清單點名（/θ/ /ð/、字尾子音 /t d k/、/iː/ vs /ɪ/、詞重音、句尾語調），示範一次、請他說一次」；加「逐字稿來自語音辨識，近音詞除非上下文證明否則不標 wordChoice」 | 無 | prompt.test：清單字串存在、「brief accent feedback」不存在 |
| E2 | judge 抽 `pronunciationNotes: string[]`（≤3，每條須為教練 turn 子字串）；`SessionReview` 加選填欄；下一場 prompt 列「上次教練點過的音」 | 與 D2 同一次改 judge | fixture：教練點名 th 一次→抽到一條；沒說→空；捏造句被驗證器丟掉；readouts／EWMA 不讀此欄（grep） |
| E4 | prompt 新段「學習者句中夾中文」：**這是詞彙缺口，不是求助**。en：立刻給目標語詞（一句繁中 gloss），請學習者**整句**用英文再說一次，教練自己不因此切成中文；ja：教練可用中文解釋（既有比例），但學習者的重說必須是完整日文；同一詞第二次夾雜只提示首音不再給答案。抽詞 prompt 加一句：優先收錄學習者以中文代替的詞，example 用教練給的目標語版本 | E1 同一 PR | prompt.test：en／ja 各斷言該段存在且「求助」段不變；items fixture：夾雜「預約」→抽出 `book a table` 且 example 為教練版本 |
| E5 | `focus.ts` 加 `kind: "gap"`（`l1Fallbacks` ≥2 時），優先序改為 meaning > gap > recurring > cando；`describeFocus`：「這幾個詞你用了中文：預約→book、…」；`microInstruction`：設計三到四個必須用到這些詞的情境，學習者整句目標語說出 | D2、D4 | focus.test：三種優先序衝突案加 gap 案各選對；gap 的 micro 指令含全部 target 詞、不含中文 said 詞 |
| E3 | grammar 項目選填 `frame`（`___` 標槽位）；驗證器：≥1 個長度 ≥2 的錨點且每錨點為 example 子字串；`uses.ts` 對有 frame 的項目用錨點依序比對 | D1（分子） | 「I'd rather stay than go」命中「I'd rather ___ than ___」；錨點順序反不命中；無 frame 舊項目行為不變；`___` 以外的 regex 字元不具意義 |

### Phase F

| # | 改動 | 相依 | 判定 |
|---|---|---|---|
| F1 | `src/apps/coach/synthetic/SyntheticLearnerAudio.ts` 實作 `SessionAudio`：`start` 立即成功；`playPcm` 累積至緩衝並依 PCM 長度排程 `onDrained`；`isPlaying` 依排程；`pauseMic`／`resumeMic` 只切旗標；`beginCoachTurn`／`endCoachTurn`／`lastCoachTurn` 以緩衝實作；`say(pcm16k)` 以 20 ms 幀節奏呼叫 `onChunk`，句尾補 600 ms 靜音 | 無 | vitest（純替身）：13 個方法皆有行為；`say` 幀數＝長度／320 samples；`onDrained` 在最後一幀後觸發 |
| F2 | `scripts/synth-lines.ts`（node，只讀 `GEMINI_API_KEY`）：把 `fixtures/transcripts.ts` 的 learner turns 以 `gemini-3.8-flash-tts` 合成 24 kHz PCM，`resampleLinear` 至 16 kHz，存 `.synthetic-cache/<sha256(text)>.pcm`（gitignored）；已存在則跳過 | 無 | 重跑第二次零 API 呼叫（計數斷言）；快取檔名不含文字；grep `AIza` 於 cache 與 log 零命中 |
| F3 | `synthetic.e2e.test.ts`（`SYNTH=1` 才跑，同 screening 慣例）：以 `PracticeSession`＋真 transport＋F1 替身跑一份 fixture；等 cue 為「you」才送下一句；結束走 `finalizeSession` 記憶體 deps；每次執行硬上限：台詞 ≤ 12 句、Live ≤ 4 分鐘，由程式斷言；印估價後直接跑 | F1、F2、D、E 合併後 | 見下表 |

F3 的二元檢查（取代 v3 標 blocked 者，用詞只准「合成已驗證」）：

| check | 判定 |
|---|---|
| F3-a 換你說時機 | 每次 cue 轉「you」時 `isPlaying()` 為 false（斷言於替身） |
| F3-b 逐字稿連續 | 送出 N 句→`who:"user"` turn 數 ≥ N×0.8（ASR 合併容忍） |
| F3-c 回聲偵測命中 | 腳本含一句照教練前句複誦→該 turn `echo===true`；其他 turn false |
| F3-d 口說求助 | 腳本含「提示一下」→其後 learner turn `aided===true` |
| F3-e 微 session 流程 | 以 focus 啟動→`finalize` 回 `{kind:"micro"}`，無 review、無 EWMA 變動 |
| F3-f 前情提要為首句 | arc 情境：第一個 coach turn 含 recap 關鍵詞（S2b-ii 補判） |
| F3-g GoAway 續接 | 另一支測試以 12 分鐘上限、台詞循環重送；`onReconnecting`→`onResumed(true)`；transcript 不清空（費用最高，單獨執行、≤13 分鐘、整輪只跑一次） |
| F3-h 判斷輸出 | judge 對合成逐字稿的 `errors.example` 全部為 learner turn 子字串（validator 既有）；CEFR 落在 fixture `expectBand` ±1 |
| F3-i 夾雜中文的 ASR | 腳本含 TTS 合成的「I want to 預約 a table for two」→ 該 learner turn 逐字稿含 Han 字元且 `l1===true`；教練下一 turn 含 `book`／`reserve`（E4 生效的探針）；ja 版：「すみません、我想要 予約」→ judge `l1Fallbacks` 非空 |

### 衛生

| # | 改動 | 判定 |
|---|---|---|
| H1 | CSP `connect-src` 收緊為 `https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com` | 真 Chrome 一場練習＋judge 無 CSP 違規；⚙️ 覆寫模型名不需改端點 |
| H2 | screening 加「型別召回」欄（fixture `expectErrorTypes` ∩ judge types）與「夾雜規則遵從」欄（兩份夾雜 fixture 的 objective 判 not met 比率、`l1Fallbacks` 子字串命中率）；規則先寫定：遵從率 ≥ 4/5 晉級 | 表格多兩欄；D2 合併後自動執行一次（出貨模型 gemini-3.8-flash，≤6 fixture × 5 次由程式斷言），之後只在換模型時重跑 |

## 5. 順序與成本

1. 先出零風險獨立項：D3、D8、E1＋E4、H1、D7 註解。
2. D1 合併後：D2＋E2 同一 PR；D6、E3 各一 PR；D2 合併後跑一次 H2（印估價後直接跑）。
3. D4→D5→E5 一 PR。
4. F1、F2 可在任何時候做（F2 以 gemini-3.8-flash-lite-tts 合成一次並快取，≤60 句由程式斷言，印估價後直接跑）。
5. F3 在 D、E 合併後執行；F3-g 單獨執行。

每個 PR：lint／tsc／vitest／build 全綠；`dist/`、cache、log 無 `AIza`；恰好一輪四路 review。

## 6. 明確不做

時間戳與音訊流暢度（不堵漏、ASR 延遲混入）；微 session 專用 judge（遷移量測已足）；LLM 驅動的學習者代理（無界）；音素評分、音高曲線；文法分類體系、句型庫；Home 整體重構；BKT；伺服器端。

## 7. 事前登錄的不確定性

- U1 回聲門檻 0.8 在真實 ASR 上的誤判率：F3-c 給第一個讀數；若誤標，調門檻不調機制。
- U2 D2 標記後 CEFR 與 a 值下降幅度：只能在真實或合成逐字稿觀察；F3-h 給合成讀數。
- U3 E2 教練是否真的會照閉集點名：F3 的 coach turns 給讀數；不照清單則 E1 措辭調整，不加欄位。
- U4 合成語音對 Live 的 VAD 與 ASR 是否等同人聲：F3-b 的 turn 數比率是探針；低於 0.8 即 F 判 fail 並登錄，不以人聲補測冒充。
- U5 Live 的輸入逐字稿對「英文句中夾中文」是否保留中文字元（而非音譯或吞掉）：F3-i 是探針。若被音譯，en 的 `l1` 純函式失效，改為與 ja 相同、全由 judge `l1Fallbacks` 回填，機制不變、來源改一處。
- U6 judge 對「靠中文詞完成的 objective 判 not met」的遵從率：H2 加入兩份夾雜 fixture 後的付費 screening 給讀數；遵從率低則改為程式側規則（該 objective 若 `l1Fallbacks.target` 命中則強制 not met），不加欄位。

真機（手機、麥克風授權、proactive audio 節奏對人的感受）維持 **blocked**，解鎖條件不變。
