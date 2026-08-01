# DEVICE_E2E — 二元驗證紀錄（Batch V ＋ 各 batch E2E 判定）

規則（照 ROADMAP Batch V）：
- 每個 check 只有 **pass / fail**（數值型附量測值）。禁止自由文字觀察。
- 任何 check 沒有判定值＝該 batch 未完成。fail 不當場修，各開一個 worklist 條目。
- **用詞界線**：V-phone 未補齊前，所有功能只得宣稱「桌機已驗證」，不得宣稱
  「手機端已驗證」。

## 環境（每平台記一次）

| 平台 | 裝置 | OS 版本 | 瀏覽器版本 | 記錄日期 |
|---|---|---|---|---|
| desktop | 開發機 | Windows 11 Home 10.0.26200 | Chrome 150 | 2026-08-01 |
| Android | | | | |
| iOS | | | | |

**桌機環境限制（影響判定，記錄一次）**：這台開發機**沒有任何實體麥克風**。
`enumerateDevices()` 只列出 Realtek「立體聲混音」（系統輸出回錄），且播放 440Hz 純音
時該裝置量到的 peak 仍為 0.00006（＝數位靜音，回錄路徑不通）。因此 Gemini Live 的
VAD 永遠不會被觸發、教練不會開口，**任何需要真實對話內容的 check 在本機無法判定**
（見 V3b、S2b-ii、D1a-ii）。這不是程式缺陷，是本機硬體事實。
**一支 USB 麥克風／耳麥即可一次解鎖這三項。**

## Batch V

### V-desktop（開發端代跑；桌機瀏覽器）

| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| V1a′ | 開網頁→開口說第一句 ≤ 6 次點擊（含允許麥克風；不含金鑰申請） | **pass** | 5 次 | 2026-08-01 |
| V1c | 金鑰卡的 AI Studio 連結在新分頁開啟 | **pass** | — | 2026-08-01 |
| V1d | 貼壞 key → 儲存被擋且訊息含「金鑰」二字的繁中句 | **pass** | — | 2026-08-01 |
| V1e | 貼正確 key → 顯示 ✓ 且金鑰卡消失 | **pass** | — | 2026-08-01 |
| V3b | 練習中殺分頁→重開：恢復卡出現，句數 ≥ 殺前 − 1 | **blocked** | 本機無麥克風→無句數可量 | 2026-08-01 |
| V3c | 練習中斷網：90 秒內出現繁中錯誤訊息（非英文原文、非無反應） | **pass** | 1 秒 | 2026-08-01 |

判定細節：
- **V1a′ = 5 次**：金鑰輸入框（聚焦）1 → 儲存 2 → 範例情境「▶ 開始練習」3 →
  「🎙️ 開始」4 → 允許麥克風 5。每一步都在本次實測中實際點過；本機麥克風權限是
  事先授予測試 profile 的，仍照實計為 1 次點擊（保守計法）。
- **V1d**：訊息為「金鑰驗證失敗：金鑰無效或已停用 — 請到 Google AI Studio
  （aistudio.google.com/apikey）確認後，在 ⚙️ 更換金鑰。」且 localStorage 未寫入。
- **V1e**：顯示「✓ 金鑰有效，已儲存在這台裝置。」、金鑰卡消失、`gemini_api_key` 已寫入。
- **V3c**：斷網 1 秒後出現「連線中斷 — 點一下重新開始。」，狀態 pill 回到「準備好」。
- **V3b = blocked（真阻擋，非 transient、非自造）**：criterion 需要「殺前句數」，
  而本機無音訊輸入 → 對話永遠是 0 句。排除清單：transient？否（硬體）。自造？否。
  替代路徑？已試兩條並記錄——列舉輸入裝置（只有立體聲混音）、播純音測回錄（靜音）；
  第三條（餵合成 PCM 繞過麥克風）會變成 behavioral fake，不採。**解鎖條件**：插上任一
  USB 麥克風／耳麥後重跑本項（或併入 V-phone 一起做）。

### V-phone（deferred 2026-08-01：使用者暫不親自實測；不阻擋開發）

| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| V1b | 開網頁→開口說總耗時 ≤ 3 分鐘（已持有金鑰） | | __ 分 | |
| V2a | 加入主畫面後開啟，首畫面＝教練 Home（Android） | | — | |
| V2a′ | 同上（iOS） | | — | |
| V2b | 主畫面圖示為 app 圖示，非瀏覽器預設（Android） | | — | |
| V2b′ | 同上（iOS） | | — | |
| V2c | 舊安裝不重裝時 start_url 是否更新 | | — | |
| V3a | 鎖屏 30 秒→解鎖：session 仍 live 且 60 秒內完成一次對答 | | __ 秒 | |
| V4a | iOS 安裝版連續兩次 session：第二次是否重問麥克風權限 | | — | |
| V4b | 拒絕麥克風 → 訊息含「麥克風權限被拒」 | | — | |

## Batch S — 各階段 E2E 判定（開工前先列 criterion，完工時判定）

### S1 — 故事狀態核心
S1 依 ROADMAP 刻意不新增畫面，因此 E2E 在真實瀏覽器裡直接驅動真模組
（vite dev 供應真 ES module、真 IndexedDB、真 Gemini API），非 UI 操作。

| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| S1a | 集尾生成呼叫被強制失敗後：arc 集數不變、可重試成功 | **pass** | 失敗後 1 集（byte-identical）→ 重試後 2 集 | 2026-08-01 |
| S1b | LearningPack 匯出→清空→匯入：arc（含 storyState）逐欄位相等 | **pass** | 10/10 欄位相等，fieldDiffs=0 | 2026-08-01 |
| S1c | DB 升版對既有資料冪等（升兩次結果相同、無資料遺失） | **pass** | v3→v4，兩次快照相同 | 2026-08-01 |

判定細節：
- **S1a**：以**真實失敗**觸發——用壞金鑰打真 `generateNextEpisode`，收到真 400
  `INVALID_ARGUMENT`。失敗後 `JSON.stringify(arc)` 與失敗前完全相同、scenarios 數量
  不變（無孤兒 scenario）；換真金鑰重試後集數 1→2，且第 2 集內容確實接續前一集逐字稿
  （storyState.events 記下「clear customs with hand luggage」等實際發生的事）。
  另附驗：pending 集存在時併發兩次 advanceArc，generator 完全沒被呼叫、集數不變。
- **S1b**：`buildPack()` → `JSON.parse(JSON.stringify())` → 清空 arcs store（確認為 0）
  → `importPack()`。比對 id/title/targetLanguage/level/premise/episodes/plannedEpisodes/
  storyState/createdAt/updatedAt 全部相等；單情境 pack 也確實夾帶所屬 arc。
- **S1c**：先用原生 IndexedDB 重建一台**真正的 v3 裝置**（v3 schema + scenario/session/
  item/objective/profile 實資料），再讓新程式碼開啟 → version=4、`arcs` store 出現、
  舊資料五類逐欄位完好；再開一次，快照與第一次完全相同。

### S2 — 單鍵劇集 UX
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| S2a | Home →開口說「下一集」 ≤ 2 次點擊 | **pass** | 2 次 | 2026-08-01 |
| S2b-i | 前情提要 ≤ 3 句（真實生成資料量測） | **pass** | 3 句 | 2026-08-01 |
| S2b-ii | 前情提要出現在第一個教練 turn（真實語音） | **blocked** | 本機無麥克風 | 2026-08-01 |

判定細節：
- **原 S2b 拆成兩半**：criterion 同時綁「≤3 句」與「出現在第一個教練 turn」，前者可在
  本機量、後者需要教練真的開口。不併成一格假 pass，故拆為 S2b-i／S2b-ii 各自判定。
- **S2a = 2 次**：Home「▶ 下一集 · 第 2 集」1 →「🎙️ 開始」2 → 狀態 pill 進入「練習中」。
  第 2 集是上一集集尾預先生成的，所以第 1 次點擊沒有等待。
- **S2b-i**：`clampRecap` 在程式層強制 ≤3 句（不信任模型）；實測真實生成的第 2 集
  recap 為 3 句繁中。並以真 arc 資料跑過 Practice 用的同一條組裝路徑，確認
  「前情提要 FIRST」出現在「Then the planning beat」之前、continuity 三行（人物／
  已發生事件／未解懸念）帶入真實內容、且含「下一集預告」收束指示。
- **S2b-ii = blocked**：同 V3b 的硬體原因。**解鎖條件**：插上麥克風後跑一次 arc 集數
  ≥2 的 session，看教練第一個 turn 是否就是 ≤3 句繁中前情提要。

### S4 — 內建示範劇集（criterion 於 2026-08-01 開工前登錄）
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| S4a | 乾淨資料下 EN／JA 各恰好 1 條示範連續劇，且各條 plannedEpisodes ≤ 6 | **pass** | EN 1／JA 1，各 6 集 | 2026-08-01 |
| S4b | 安裝示範劇：**零 API 呼叫**即可開練第 1 集；安裝後該示範從清單消失，且重覆安裝不產生第二條（stable id） | **pass** | 離線安裝成功；重裝後仍 1 arc／1 scenario | 2026-08-01 |
| S4c | 示範劇第 2 集生成後：沿用 outline 指定的下一段落，且延續同一 storyState 種子的人物 | **pass** | 第 2、3 集都命中對應段落 | 2026-08-01 |

判定細節：
- **S4a**：EN「倫敦出差：從入境到應酬」、JA「東京自由行：五天連續劇」，各 6 集、7 個
  can-do、6 段 outline；每個語言的 Home 上只出現 1 張示範卡。授撰資料另有 16 個單元
  測試把關（outline 長度＝集數、can-do 6–8 且不重複、episode1 欄位齊全、recap ≤3 句、
  storyState 種子有人物與懸念但 events 為空、**無簡體字**）。
- **S4b**：以 DevTools 設 `Offline` 後點「▶ 從第 1 集開始」→ 成功安裝並進入第 1 集
  「希斯洛入境：行李沒跟上」，畫面無任何錯誤訊息（第 1 集全部是授撰內容，不需模型）。
  id 為 `def-arc-en-london-trip` / `-ep1`；再次 `installDemoArc` 後仍是 1 條 arc、
  1 個 scenario（stable id 覆寫而非新增）。
- **S4c**：走真實 finalize 生成第 2 集 →「Aligning Strategies at the London Office」，
  對應 outline 第 2 段「抵達倫敦辦公室：與當地同事 Priya 對接…」，內容確實提到 Priya；
  第 3 集「The Pitch under Pressure」對應第 3 段「客戶會議：向 Daniel 說明…」，Daniel
  與 Priya 都在場。storyState 人物固定為 Priya Raman／Daniel Whitfield，events 依實際
  逐字稿累積到 4 筆。

### S3 — 劇集綁課綱（criterion 於 2026-08-01 開工前登錄）
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| S3a | 每條 arc 綁 6–8 個 CEFR can-do，且文字在建立後固定（走完一集後逐字不變） | **pass** | 7 個；走完 2 集後 JSON 逐字相同 | 2026-08-01 |
| S3b | 每集鎖定 1–2 個 can-do；集尾判決累積在 **arc 層** key —— 同一 can-do 跨兩集後 attempts = 2（不分裂成兩筆） | **pass** | attempts = 2，列數不變 | 2026-08-01 |
| S3c | arc 卡顯示「第 N／約 M 集」與本集 can-do，且畫面上不出現任何分數／百分比 | **pass** | — | 2026-08-01 |

判定細節：
- **S3a**：7 個 can-do（`cd1`…`cd7`）。跑完兩集真實 finalize（含兩次下一集生成）後，
  `JSON.stringify(arc.canDos)` 與建立時完全相同——模型只能用 1-based index 挑，
  `resolveCanDoIds` 會丟掉越界／重複／非整數的選擇，永遠不改寫文字。
- **S3b**：第 1 集鎖 cd1、第 2 集鎖 cd2（模型被要求優先挑沒練過的）。兩集真實
  finalize 後 arc 層 ledger 為 2 列、各 attempts=1，key 形如
  `def-arc-en-london-trip::能在入境與交通場景說明來意，並處理突發狀況`。接著對 cd2
  再送一次判決（呼叫 finalize 用的同一個 `recordJudgeOutcomes`）→ **同一列** attempts
  變 2、met=1、lastMet=false，列數不變。同一批判決在 episode 的 scenario 上另有 5 列
  （每集自己的目標留在自己那列），證明 key 是 arc 範圍而非 episode 範圍。
- **S3c**：卡面為「第 3 集 · 全劇約 6 集（已練 2 集）」＋兩行「◦ 這集練：…」，
  全頁無百分比、無分數字樣；episode 的 scenario 不出現在「你的情境」清單（顯示 0）。

### D1 — 最小跟讀（criterion 於 2026-08-01 開工前登錄）
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| D1a-i | 跟讀面板可錄下自己的版本，並能 A/B 重播兩段音訊（任一時刻只有一邊在播） | **pass** | 教練 1.000s／我的 1.14s，皆實際播放推進 | 2026-08-01 |
| D1a-ii | 該教練音訊來自真實 live 教練輪 | **blocked** | 本機無麥克風 → 教練不開口 | 2026-08-01 |
| D1b | 跟讀流程全程不出現任何分數／評分／百分比文字（守住 ROADMAP 紅線） | **pass** | 0 個分數字樣、0 個百分比 | 2026-08-01 |
| D1c | 未授權／無麥克風時給出繁中錯誤訊息，且不影響進行中的 live session | **pass** | — | 2026-08-01 |

判定細節：
- **D1a-i**：以真 `AudioEngine` 餵入真 PCM16（provider 格式）走完整條路——
  `beginCoachTurn` → `playPcm`×N → `endCoachTurn` → 擷取到 24000 samples @24kHz
  （正好 1.000 秒）→ `encodeWav` → Blob → `new Audio()` 載入 duration=1.000 且
  `currentTime` 實際推進；學習者側用真 `MediaRecorder` 錄到 19616 bytes
  `audio/webm;codecs=opus`、duration 1.14s、同樣實際播放推進，且停止後 mic track
  `readyState` 為 `ended`（麥克風確實釋放）。再把**真的 Shadowing 元件**配上這段真
  clip 掛進頁面跑完整流程：錄音中兩顆播放鍵停用；錄完「我的」啟用；播教練時教練鍵變
  「■ 停」而「我的」維持「▶」，播我的時反之——A/B 任一時刻只有一邊在播。
  另驗兩條保護：barge-in 打斷的半句**不會**成為跟讀範本（`flushPlayback` 丟棄進行中
  的擷取，前一句完整範本保留）；單輪擷取上限 30 秒（餵 40 秒只留 30 秒）。
- **D1a-ii = blocked**：與 V3b／S2b-ii 同一個硬體原因（本機無麥克風→Gemini Live 的
  VAD 不被觸發→教練不開口）。**解鎖條件**：插上麥克風後練一段，暫停時確認跟讀面板的
  「教練的」就是教練剛說那句。
- **D1b**：初始／錄音中／錄完／A-B 播放四個狀態的文案全部掃過，無百分比、無評分字樣。
  唯一命中「分數」的是刻意寫的否定句「這裡**不打分數**，只讓你自己聽出差別。」
- **D1c**：真實觸發 `getUserMedia` 失敗（要求不存在的 deviceId → 真 `OverconstrainedError`）
  → 訊息為繁中「找不到麥克風 — 請確認裝置有麥克風且未被其他 app 佔用。」
  **這一項原本是 fail**：`describeError` 只認 `NotFoundError`，`OverconstrainedError`
  會漏成英文原文，已修並補單元測試。live session 隔離也實測：暫停中開跟讀後狀態仍為
  「已暫停」，「▶ 接續」「■ 停止並儲存」都還在（跟讀用自己的短命 stream，不碰 session）。

### 本批修掉的兩個真缺陷（E2E 抓出來的）
1. **CSP 沒有 `media-src`** → `default-src 'self'` 讓 `blob:` 音訊被 Chrome 擋掉
   （`MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`），跟讀的兩段重播
   在正式環境會完全播不出來。已在 `coach.html` 加 `media-src 'self' blob:`（launcher
   不播媒體，維持較緊）。修好後同一個探針立刻由 fail 轉 pass。
2. **`describeError` 漏 `OverconstrainedError`** → 見 D1c。
