# eng-coach 藍圖 v5（2026-11-01）— 體驗感：台灣語境、情境帶入、輪替與收場、輕鬆使用

基準：`main` HEAD `194781e`，工作樹乾淨；vitest **436 ✓／8 skipped**（2026-11-01 實跑）。
前置：`docs/BLUEPRINT_2026-09-28.md`（v4）與 ROADMAP「Update 2026-10-05」。本文件取代 v4 §5 之後的後續。
配套 GOAL 指令：`docs/GOALS_2026-11-01.md`。

## 0. 已查證事實（每條有探針）

| 事實 | 探針 |
|---|---|
| Live 教練 prompt 有台灣國語強規則；文字模型六個呼叫點中 `scenario.ts` 無中文變體規則、`items.ts` 詞義與 `replies.ts` gloss 只寫 Traditional Chinese、`review.ts` wins/fixes 語言未指定、`arc.ts` 只有 recap 與 canDos 寫台灣 | `grep -rn -i "taiwan\|Traditional Chinese" src/apps/coach/ai` |
| 文字模型只有一個入口 `generateJson`（`ai/client.ts`） | 檔首註解＋grep `generateContent` 只一處 |
| Live 原生音訊模型不接受 `languageCode`，台灣腔只能靠 prompt 與音色 | `gemini-direct.ts:186`、`voices.ts:9` |
| 音色每場 `Math.random` 選取，同一故事線角色每集換聲 | `voices.ts pickVoice` |
| `LearnerProfile` 無稱呼／職務欄；`prefs` 只有 `slowSpeech`／`showLevelMeter`；pack 匯入逐欄 narrowing | `types.ts:177–188`、`packSchema.ts:125–139` |
| 練習頁開始前只畫標題、兩個 pill、`contentContext`；角色、目標、目標句不在畫面 | `Practice.tsx:538–543` |
| 收場順序要求入戲收尾但不要求交代結果；session 無收場狀態；靜默指示在 cue 轉 you 後 10 s 照送 | `prompt.ts:222–228`、`session.ts:176–245`、grep 結束標記零命中 |
| 靜默指示用完（3 則）後 owner 不再送、畫面無提示 | `session.ts:185` |
| 「換你說」只有畫面 role=status；無聲音、無震動 | `Practice.tsx:558–561`；grep `vibrate`／`createOscillator` 零命中 |
| 教練逐字稿以 delta 經 `onTranscript("coach")` 進 Practice 累積；owner 看得到每段 delta | `session.ts:470`、`Practice.tsx:262` |
| 九個英文預設 `contentContext` 含後設語句（「這是對話流暢度練習，不是技術深談」） | `defaults.ts` grep 「不是」 |
| 種子簡報格式＝地點、具名人物、要達成的事、一個轉折 | `seeds.ts` 檔首註解 |
| 首頁首頁不捲動區同時有 7 類可點行動；`Home.tsx` 1140 行 | `Home.tsx:537–752` |
| 練習頁無 `navigator.permissions` 查詢；開始永遠要再點一次 | grep 零命中、`Practice.tsx:607` |
| finalize 於 judge 後串行 await 下一集生成；`advanceArc` 已有進行中去重 | `finalize.ts` §arcAdvanced、`arcs.ts:415–425` |
| 回顧卡攤開：四項分數帶、中英評語、can-do 自評、wins、fixes、錯誤型態、下次重點、焦點卡 | `Practice.tsx:770–805` |
| `Sheet` 為原生 `<dialog>`，可重用 | `Sheet.tsx:9` |
| `AudioEngine` 持有 `AudioContext`，可直接排程振盪器 | `AudioEngine.ts:54,92` |

## 1. 不變量（承 v4，新增四條）

零後端／BYOK／IndexedDB＋LearningPack。不加狀態機套件、DI、bus、多供應商抽象、function-call 工具群、schema 編譯器、Playwright。無 streak／提醒。每項改動能陳述「改動→行為差異→結果動，因為[機制]」。範圍外發現只登錄不動手。
- **新增**：所有中文輸出（語音與文字）必須是台灣語境、台灣腔、台灣用語。規則只有一個正本；驗證器 fail-closed。
- **新增**：不新增任何付費 API 呼叫；本藍圖每一項都是 prompt 改寫、純函式、搬 JSX 或一次性內容改寫。
- **新增**：每個新 profile／prefs 欄位皆選填；缺席＝舊行為；LearningPack 匯出入 round-trip。
- **新增**：聲音與震動提示只在 cue 轉「you」觸發，教練說話中、暫停、重連、收場後皆不觸發。

## 2. 相依性

```
Phase T 台灣語境機械化（T1 正本 → T2 驗證器 → T3 語音語例）
   │  T1/T2 先合：之後每個會出中文的 prompt 都走它
   ▼
Phase I 情境帶入（I1 身分 ─ I2 音色 ─ I3 任務卡 ─ I4 入戲開場 ─ I5 預設改寫）
   │  I1 依賴 T1（身分段中文規則）；I3 獨立；I4 依賴 T3；I5 依賴 T2（改寫後內容過驗證器）
   ▼
Phase C 輪替與收場（C1 提示音／震動 ─ C2 收場偵測＋入戲結局 ─ C3 預算用完提示）
   │  C2 依賴 T3（結束語台灣口吻）；C1、C3 獨立
   ▼
Phase U 輕鬆使用（U1 首頁減法 ─ U2 自動開始 ─ U3 回顧減法 ─ U4 下一集背景）
      U1 與 I3 共用 Sheet；U3 獨立；U4 獨立；U2 獨立
```

T 先合。I、C 可平行（各開分支）；U 最後，因為 U1 搬動 Home 會與 I1 的設定欄位同檔，I1 先合。

## 3. 四句 GOAL

### Phase T — 台灣語境機械化
> **讓任何一個會產生中文的呼叫點，都無法產出簡體字或中國用語；規則一個正本，違反即被驗證器丟棄。**
> 做法邊界：常數放 `ai/client.ts`，`generateJson` 自動附加；驗證器為純函式閉集比對，不呼叫模型；Live 語音無法驗證，只強化 prompt 語例。

### Phase I — 情境帶入
> **讓學習者在開口前就知道自己是誰、對方是誰、這場要做到什麼；讓同一個角色在整條故事線用同一個聲音；讓情境描述是處境而不是練習說明。**
> 做法邊界：全部讀現有 Scenario 欄位或新增的選填 profile 欄位；零 API；不加頭像、配圖、背景音。

### Phase C — 輪替與收場
> **讓學習者不看螢幕也知道輪到自己；讓教練的收尾就是 session 的結尾，且有入戲的結局；讓靜默指示用完後學習者知道下一步。**
> 做法邊界：閉集結束語常數與 `HELP_TRIGGERS` 同手法；收場狀態由 owner 持有；不加 function calling；提示音用振盪器零資產。

### Phase U — 輕鬆使用
> **讓首頁一眼只有一個主行動；讓已授權的裝置免再點開始；讓回顧只剩一個焦點與自評；讓回顧不必等下一集寫完。**
> 做法邊界：只搬 JSX、不改資料；自動開始 fail-closed（權限非 granted 即維持按鈕）；回顧資料不變只改預設可見性。

## 4. 工作清單（二元判定；每項附八維驗證）

八維代號：**正**確性／**效**：有效性（目標指標位移）／**依**：相依／**完**：可完成性／**健**：穩健性（壞輸入）／**靠**：可靠性（失敗模式）／**擴**：可擴充性／**安**：安全性。

### Phase T

| # | 改動 | 八維驗證 | 判準 |
|---|---|---|---|
| T1 | `ai/client.ts` 匯出 `ZH_TW_RULE` 常數（繁體台灣用語；列 10 組禁用→改用對照：信息→資訊、軟件→軟體、視頻→影片、質量→品質、默認→預設、屏幕→螢幕、鼠標→滑鼠、交互→互動、鏈接→連結、數據庫→資料庫；禁簡體字）；`generateJson` 在 prompt 末自動附加；`scenario.ts`、`arc.ts`、`items.ts`、`replies.ts`、`review.ts`、`translate.ts` 刪掉各自的中文變體句 | 正：grep 全 `src` 只剩一處定義。效：六個呼叫點全部受規則。依：無。完：純字串。健：常數附加不影響 responseSchema。靠：附加失敗＝測試紅。擴：新 capability 自動受規則。安：無 | vitest：`generateJson` 替身收到的 prompt 以 `ZH_TW_RULE` 結尾；grep `"Traditional Chinese"` 於 `src/apps/coach/ai` 只命中 `client.ts` |
| T2 | `kernel/zhTw.ts` 純函式 `zhTwProblem(text): string \| null`：閉集簡體字表（≥40 字，取繁簡字形不同且高頻者：这 说 们 时 会 个 国 发 还 对 学 电 车 门 问 ...）與閉集中國用語表（T1 的 10 組＋软件／视频 之類簡體寫法自動涵蓋）；命中回傳「含簡體字『这』」或「含中國用語『信息』」。各 parser 對中文欄位呼叫：`parseScenarioDraft`（title／contentContext／coachRole／userRole／objectives）、`parseEpisodeDraft`＋recap＋canDos、`parseRawItem.meaning`、`parseSuggestion.gloss`、`reviewParser.reviewZh`／wins／fixes、`translate`；命中即該樣本 `Invalid`（judge 走既有丟樣本路徑） | 正：雙側 fixture。效：中國用語無法落地。依：T1 無硬依賴，但一起合。完：純函式。健：空字串、英文、日文假名、日文漢字（「电」不在日文常用字；表內避開日文當用漢字如 会／学／国：**日文欄位不掃**，只掃標記為中文的欄位）。靠：fail-closed；judge 零樣本＝既有 `unavailable` 路徑。擴：表格可加。安：無 | vitest：含「软件」「信息」「这个」被拒且訊息可辨；含「軟體」「資訊」「這個」通過；日文 contentContext 含「会計」不被掃（欄位不在清單）；judge 一份 wins 含簡體 → 樣本丟棄 → `unavailable` 理由可辨 |
| T3 | `prompt.ts` 台灣國語段加語例：說「好喔、沒問題、這樣喔、對啊、不會、欸」；不說「挺好的、行、沒事兒、咱們、牛、靠譜」；禁兒化；數字與時間用台灣慣用（「禮拜三」「下午三點半」）。前情提要與規劃拍段引用同一常數 | 正：prompt.test。效：Live 語音口吻。依：無。完：字串。健：無。靠：無。擴：語例為常數。安：無 | vitest：`composeSystemInstruction` 輸出含全部「說」語例與「不說」語例；常數只定義一次 |

### Phase I

| # | 改動 | 八維驗證 | 判準 |
|---|---|---|---|
| I1 | `LearnerProfile.persona?: { name?: string; jobTitle?: string; orgType?: string }`；`packSchema` narrowing；設定 Sheet 三個選填輸入（長度 ≤40，trim）；`prompt.ts` 新段「── The learner ──」：en 用稱呼叫他、把 userRole 改成他的職務與公司型態；ja 只用稱呼、旅客身分不變。全空＝整段不存在 | 正：prompt.test 雙側。效：教練叫得出名字。依：T1（段內中文規則）。完：三欄。健：>40 字截斷、全空白視為空、特殊字元原樣進 prompt（不解譯）。靠：儲存失敗走既有 `putProfile` 錯誤路徑。擴：欄位物件可加。安：persona 隨 pack 匯出，屬本機資料；不送任何第三方除 Gemini | vitest：有 name 則 prompt 含該名且含「address them」；全空則段落不存在；pack round-trip 保留；舊 pack 無 persona 可匯入 |
| I2 | `voices.ts` `pickVoice(language, seed: string)`：FNV-1a 雜湊 seed 取模池長；Practice 以 `scenario.arc?.arcId ?? scenario.id` 為 seed | 正：純函式測試。效：同角色同聲。依：無。完：10 行。健：空 seed 走池首。靠：無。擴：池可調。安：無 | vitest：同 seed 同音色 ×100；100 個不同 seed 覆蓋池中每個音色至少一次；`Math.random` 於 `voices.ts` grep 零命中 |
| I3 | `TaskCard.tsx`：你扮演／對方／這場要做到（objectives 前 3，其餘「還有 N 項」）／可以用的句子（targetPhrases 前 3）；開始前展開、live 中收合為一列，點開展開；收合狀態存 `prefs.taskCardOpen` | 正：元件測試。效：開口前知道任務。依：無。完：讀現有欄位。健：objectives 空陣列不畫該段。靠：無。擴：欄位加一行。安：無 | vitest：三種資料形態渲染正確；Chrome 替身截圖兩狀態 |
| I4 | `prompt.ts` 單場開場：規劃拍前新增「(0) ONE in-character Taiwan-Mandarin sentence setting the scene: where they are, what just happened, what they want」；arc 情境維持 recap 優先 | 正：prompt.test 順序。效：第一句就入戲。依：T3。完：字串。健：無。靠：無。擴：無。安：無 | vitest：單場 prompt 中 scene 句位於規劃句之前；arc prompt 不含該句 |
| I5 | `defaults.ts` 9 英 10 日全部改寫為種子格式；每筆 contentContext 含地點、具名對方、要達成的事、一個阻力；coachRole 含人名；刪除「練習」「不是」「流暢度」等後設詞；日文預設描述改繁中（原為日文，學習者看不懂） | 正：內容測試。效：處境而非說明。依：T2（內容過驗證器）。完：內容工作。健：id 不變，已練過的紀錄不受影響。靠：無。擴：無。安：無 | vitest：每筆 `zhTwProblem` 為 null；contentContext 不含「練習」「不是」；coachRole 含至少一個非中文姓名或日文姓氏；stable id 全部保留 |

### Phase C

| # | 改動 | 八維驗證 | 判準 |
|---|---|---|---|
| C1 | `AudioEngine.chime()`：80 ms 正弦 880 Hz、增益 0.15、線性淡出，排在 context 當前時間；`SessionAudio` 介面加 `chime()`（合成替身為 no-op）；owner 在 cue 轉「you」且 `!paused && !reconnecting && !closing` 時呼叫 `chime()` 並 `navigator.vibrate?.(60)`；`prefs.turnCue?: boolean`（預設 true）；練習頁按鈕 🔔 切換 | 正：owner 測試。效：不看螢幕知道輪到自己。依：無。完：30 行。健：`vibrate` 不存在不拋；AudioContext suspended 時 chime 無聲不拋。靠：chime 例外被 catch 不影響 session。擴：音色參數常數。安：無 | vitest：cue 轉 you 觸發一次；教練說話中、暫停、重連、收場後零觸發；prefs 關閉零觸發；合成替身 `chime` 存在且無副作用 |
| C2 | `prompt.ts` 匯出 `CLOSING_LINE = "今天就練到這裡"`；收場順序第 1 步改「Close the scene IN character AND state the concrete OUTCOME of the learner's goal」、最後一步「say exactly 『今天就練到這裡』 as your final words」；微 session 的「好，這段結束。」改為同一常數。`session.ts` 累積當前教練 turn 文字，含 `CLOSING_LINE` 即 `closing=true`：清靜默計時、不再 arm、`onPhase` 帶 `closing`；Practice 收場狀態顯示「教練已收尾」＋大「■ 儲存」；owner 於 closing 後 15 s 無學習者逐字稿呼叫 `onAutoStop`，Practice 走 `stopAndFinalize`。學習者 closing 後開口＝取消自動停止但 closing 不清（指示仍不送） | 正：雙側。效：結局＋不重開戲。依：T3。完：常數＋狀態。健：結束語被 ASR 切成兩段 delta 仍命中（累積比對）；誤命中（教練中途引用）只會提前停指示，不會自動停（15 s 內學習者通常會說話）→ 登錄為已知取捨。靠：自動停止走既有 Stop 路徑；finalize 失敗走既有錯誤分支。擴：常數可改。安：無 | vitest：含結束語→指示零、15 s 假時鐘後 stop 被呼叫；不含→指示照送；closing 後學習者開口→不自動停；暫停中不自動停。合成腳本（SYNTH=1，≤12 句／≤4 分）：教練收尾後指示數 0、session 自動結束、judge 可評 |
| C3 | 靜默指示用完：owner `onNotice("教練在等你。可以說「提示一下」，或按暫停休息一下。")` 一次；學習者開口清除 | 正：owner 測試。效：不再無聲死等。依：無。完：3 行。健：無。靠：無。擴：無。安：無 | vitest：第 3 則送出後靜默再 15 s → notice 一次且不再重複；開口後 notice 清空 |

### Phase U

| # | 改動 | 八維驗證 | 判準 |
|---|---|---|---|
| U1 | Home 首頁不捲動區只留：讀數條、主按鈕（規則：未完 arc→下一集；否則 lastPracticed→再練一次；否則→換個新劇情 單場）、換個新劇情卡、金鑰卡（僅無金鑰時）、恢復卡（僅有草稿時）。「你的情境」「範例」「新增情境」整段搬進 `ScenariosSheet.tsx`（Sheet），由首頁不捲動區一顆「情境與新增」ghost 按鈕開啟；ScenarioCard 的編輯／匯出／刪除收進卡片「⋯」展開。只搬 JSX，所有 handler 不改 | 正：元件測試＋替身。效：首頁不捲動區可點行動 ≤3。依：I1 先合（同檔）。完：搬動。健：空狀態（無情境、無金鑰）仍有主按鈕。靠：Sheet 關閉不丟表單草稿（state 留在 Home）。擴：Sheet 可裝更多。安：無 | vitest：主按鈕四種狀態各選對；Home.tsx 行數下降；Chrome 替身 390×844 不捲動可見主按鈕；首頁不捲動區 `button` 數 ≤3（不含 topbar） |
| U2 | Practice 掛載時 `navigator.permissions?.query({name:"microphone"})`；回 `granted` 且 `autoStart` prop 為真才 `start()`；其他狀態（denied／prompt／拋錯／API 不存在）維持按鈕 | 正：雙側。效：每場少一次點擊。依：無。完：15 行。健：query 拋錯＝不自動。靠：start 失敗走既有 `start-failed`。擴：無。安：不繞過權限模型 | vitest：granted→start 一次；prompt／denied／拋錯→零次且按鈕存在；`autoStart` 假→零次 |
| U3 | 回顧預設只顯示：can-do 自評、焦點卡、第一個 win、第一個 fix；「看完整回顧」展開其餘（分數帶、中英評語、其餘 wins／fixes、錯誤型態、下次重點）。資料與儲存不變 | 正：元件測試。效：一場一焦點。依：無。完：條件渲染。健：無 review 時既有分支不變。靠：無。擴：無。安：無 | vitest：預設 DOM 不含「文法」「CEFR」字樣；展開後含；`already` 分支亦同 |
| U4 | finalize：`advanceStory` 不 await，改 `void`＋`catch` 登錄；outcome.story 改為 `{ played, advanced: "pending" }`；Home「下一集」既有 `advanceArc` 去重會等同一個 promise | 正：finalize 測試。效：回顧提早顯示。依：無。完：改一處。健：生成失敗＝arc 不動，下一集按鈕重試（既有）。靠：ledger `arcAdvanced` 於背景完成後 tick。擴：無。安：無 | vitest：finalize 回傳時 `advance` 尚未 resolve；背景完成後 ledger tick；失敗不影響 outcome；連點下一集 generate 只呼叫一次 |

## 5. 順序與每項 DoD

1. T1→T2→T3 一個分支、一個 PR。
2. I1、I2、I3、I4、I5 各一 commit；C1、C2、C3 各一 commit；兩組可平行。
3. U1→U2→U3→U4。
4. 每個 commit：lint／tsc／vitest／build 全綠；`dist/` 無 `AIza`；新欄位有「舊紀錄無此欄仍可讀」測試；恰好一輪唯讀審查子代理，結論由主代理親驗。
5. 付費只在 C2 的一支合成腳本（≤12 句／≤4 分鐘，印估價後直接跑）。

## 6. 明確不做

function calling 結束工具；畫面選項分支；頭像、配圖、背景音；靜默秒數調整；新學習機制；Live `languageCode`（模型不接受）；中國用語表的模型化偵測（只用閉集）；自動開始於 iOS（查不到權限即不做）。

## 7. 事前登錄的不確定性

- U1′ 閉集簡體字表與日文漢字重疊：以「只掃中文欄位」避開；若日文欄位之後要掃，須另建排除表。
- U2′ 教練是否每次都照說結束語：合成腳本給第一個讀數；不照說＝只失去自動停止，靜默指示仍會停（因 closing 未觸發則維持舊行為）。登錄，不加欄位。
- U3′ 880 Hz 80 ms 在手機喇叭是否聽得到：真機 blocked；參數為常數。
- U4′ Android Chrome `permissions.query` 對麥克風的支援：桌機 Chrome 替身可驗；真機 blocked。
