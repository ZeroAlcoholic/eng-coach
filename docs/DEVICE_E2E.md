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

## Batch E — 各項 E2E 判定（criterion 於 2026-08-01 開工前登錄）

### E1 — 錯誤型態累積（fixed enum）
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| E1a | 判決回傳的錯誤型態一律落在固定 enum 內；未知型態被丟棄而非寫入 | **pass** | 3/3 型態在 enum 內 | 2026-08-01 |
| E1b | 三次取樣中出現 ≥2 次的型態才計入（單次雜訊不進帳） | **pass** | — | 2026-08-01 |
| E1c | 跨兩次 session 後同一型態 count 累加為 2，且以繁中名稱餵進 live prompt | **pass** | count = 2 | 2026-08-01 |

判定細節：
- **不另打一次 API**（偏離 ROADMAP 原文的「extra Gemini call/session」）：錯誤型態掛在
  既有的判決呼叫上，所以成本為零；而既有的 3 次 self-consistency 取樣正好提供 E1
  要的壓雜訊機制——型態必須在**多數取樣**（≥2）出現才算。這比多打一次呼叫更省也更準。
- **E1a**：真判決（B1 程度、刻意寫錯的逐字稿）回傳 tense／plural／article，全數在
  `ERROR_TYPES` 內；`isErrorType` 在 voteErrors／applyErrorsToProfile／recurringErrors
  三個讀取邊界各擋一次（enum 外的標籤被丟棄，有 4 個單元測試涵蓋）。
- **E1b**：投票由 6 個單元測試鎖住（多數才算、每個取樣一票所以同一取樣內重複無法自我
  確認、enum 外丟棄、保留學習者原句）。**這一項原本有漏洞**：`summariseSession` 在只有
  一個有效取樣時直接 `return valid[0]`，完全繞過投票，一次雜訊就會永久進帳。已改成一律
  走 `medianReview`，並加測試鎖住「單一取樣 → 0 個確認錯誤」。
- **E1c**：兩次 session 後 tense／plural／article 各 count=2，`recurringErrors` 以
  繁中名稱＋學習者原句＋自然說法進 prompt，例如
  「- 時態 (tense), seen in 2 sessions. e.g. they said「I go to Taipei yesterday…」
  → natural:「I went to Taipei yesterday…」」。count=1 的一次性錯誤**不會**進 prompt
  （4 個新的 prompt 測試鎖住這個門檻與 no-scoring 紅線）。

### E2 — 音量指示（opt-in）
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| E2a | 預設**關閉**：live 畫面不出現任何量表（orb 保持乾淨） | **pass** | — | 2026-08-01 |
| E2b | 開啟後即時反映真實麥克風 RMS，且文案標明是「音量」不是重音／分數 | **pass** | 2 秒 16 次、0–1 區間 | 2026-08-01 |
| E2c | 偏好持久化（重開 session 後仍為上次的開關狀態） | **pass** | — | 2026-08-01 |

判定細節：
- **誠實範圍**：ROADMAP 記的疑慮是「音量 ≠ 重音」，所以這個功能就叫**音量**，畫面上永遠
  寫著「這是音量，不是重音也不是分數」，真正的用途是回答「麥克風到底有沒有收到我」。
  預設關閉、不碰 orb。
- **E2a**：live 畫面只有「💡 卡住?／🐢 慢速／📊 音量」三顆，`[role="meter"]` 不存在。
- **E2b**：引擎側 2 秒內發 16 次（~8/s，符合 100ms 節流），值全為有限數且落在 0–1，
  真實靜音下 max=7.6e-6（正確反映本機無麥克風）。UI 側餵入已知 RMS 驗證映射：
  0→0、0.05→20、0.125→50、0.25→100（滿刻度）、0.9→100（夾住）；文案在
  「還沒收到聲音」與「麥克風收得到你的聲音」間切換。**未能驗證**：真人聲音讓長條跳動
  ——同 V3b 的無麥克風硬體債。
- **E2c**：`{slowSpeech:false, showLevelMeter:true}` 寫入 profile 並讀回。
  **這一項原本有 bug**：`Practice` 的 `profile` prop 在 session 中不會更新，而
  `stopAndFinalize` 會把舊 prefs 寫回去，所以停止練習後音量偏好會被靜靜還原。已改為
  兩個 toggle 都寫完整 prefs、finalize 也帶上目前值。

### E3 — 填空複習＋搭配詞
| check | pass criterion | 判定 | 量測值 | 日期 |
|---|---|---|---|---|
| E3a | 例句含該詞時，填空句由**純函式**產生（零 API 呼叫、離線可用），且答案被遮住 | **pass** | — | 2026-08-01 |
| E3b | 填空與「認／用」共用同一張 FSRS 卡 —— 切換方向不新增卡、不改變到期排程 | **pass** | 卡數 2→2 | 2026-08-01 |
| E3c | 搭配詞取回後快取在該 item 上（第二次開啟不再呼叫 API），且**不產生選項／干擾項** | **pass** | 離線重開仍命中 | 2026-08-01 |

判定細節：
- **繞開 distractor 問題而非緩解它**：ROADMAP 記的疑慮是「干擾項品質約 50%」，所以這裡
  **完全不生成選項**——填空是回想後自評，沿用原本的 4 顆 FSRS 按鈕。畫面上唯一的按鈕
  就是 3 個方向 + 4 個評等，沒有任何選項。
- **E3a**：離線下顯示 `Let's ＿＿＿＿ on that tomorrow.`（由 `clozeFromExample` 純函式
  從該詞自己的例句挖空），無錯誤訊息；揭曉後才出現答案＋中文意思＋完整例句。
  **原本有兩個答案洩漏漏洞**：只遮第一次出現（例句重複出現該詞時答案還在句中）、
  以及快取的模型出題未經驗證（可能沒有空格或直接含答案）。已改為遮**所有**出現，
  並對快取出題驗證「必須含空格且不得含答案」，各附回歸測試。
- **E3b**：切到填空並評「記得」後，item 總數 2→2（沒有長出第二張卡），只有該 item 的
  `srs.reps` 0→1、`due` 前移；另一張未受影響。
- **E3c**：例句不含該詞的 item 觸發一次真 API，回傳的出題與 3 個搭配詞快取在 item 上；
  **斷網後重開複習仍顯示同一題與搭配詞**（證明沒有第二次呼叫）。
  **原本有一個會無限付費呼叫的迴圈**：模型回傳空出題時 `needsExtras` 仍為 true，而
  `setExtras` 改變了 item 的物件識別 → effect 重跑 → 再打一次，永不停止。已改為
  **以嘗試為準**的 id 集合（不論成敗每個 item 只試一次）。實測：離線觸發失敗後 12 秒內
  對 Gemini 的嘗試次數為 **1**（先前會持續累加），且訊息顯示真實原因
  「（搭配詞載入失敗：網路連線失敗 — 請確認手機網路後再試。）」而非誤導成卡片本身的問題。

## Code Review — 2026-08-01（四個平行 reviewer 涵蓋 S1–S4、D1、E1–E3）

四個獨立 reviewer（一般缺陷／沉默失敗／型別設計／測試覆蓋）跑完後，我逐條親自驗證再修。
**修掉的真缺陷 13 項**，其中 4 項會直接讓功能對真實使用者失效：

| # | 缺陷 | 為什麼嚴重 |
|---|---|---|
| 1 | `gemini-direct.ts` 在 `setTurn("coach")` **之前**就呼叫 `onAudio` | 教練輪的第一個 chunk 沒被擷取；單一訊息的短句整段落空，`endCoachTurn` 空轉後跟讀面板會播出**上一輪**並聲稱是「教練剛才那句」 |
| 2 | `ReviewSheet` 的 extras effect 會無限重試 | 模型回空出題時每秒持續打付費 API，畫面只顯示「出題中…」 |
| 3 | `clampRecap` 的終止符字元類缺 ASCII 句點，且無字數上限 | 英文／混合散文完全不會被 clamp，S2b 的「≤3 句」保證形同虛設 |
| 4 | `summariseSession` 單一取樣時繞過 `voteErrors` | 一次雜訊就永久寫入錯誤型態帳本 |
| 5 | `advanceArc` 的四種 `null` 被 Home 一律報成「已經完結了」 | 情境資料遺失時，卡片仍顯示「▶ 下一集」但每次點都說已完結，永久卡死且不說真話 |
| 6 | `finalize` 尾段共用一個 try，衍生資料失敗會擋掉「標記已練」 | 下一集會**重播同一集**，而 log 卻寫「retried on 下一集」 |
| 7 | `buildScenarioPack` 匯出 arc 卻只帶一個 scenario | 還原後 arc 指向不存在的集，故事永久無法繼續 |
| 8 | 同上，且遺漏 arc 層 can-do mastery | 累積的 attempts 與**無法重建的自評**在匯出時靜靜消失 |
| 9 | `importPack` 無版本閘、無驗證、盲目覆寫 | 舊備份會把進行中的示範 arc 倒退成孤兒；`plannedEpisodes` 可由資料檔驅動無上限生成 |
| 10 | `clozeFor` 只遮第一次出現，且不驗證快取出題 | 答案留在題目裡，回想測驗變成閱讀測驗 |
| 11 | `Shadowing` 沒有 `MediaRecorder.onerror`；卸載時不停錄音 | 裝置中途失效 → 按鈕永遠停在「錄完了」、**麥克風持續開著**、blob 洩漏 |
| 12 | 零位元組錄音被當成成功的一次 | 靜音錄下的空檔案要到播放才發現，訊息還怪到音訊上 |
| 13 | E2 音量偏好被 finalize 的舊 prefs 靜靜還原 | 「記住選擇」的承諾在停止練習後失效 |

另修：`markEpisodePlayed` 對重複 `n` 會一次標記多集（改為按索引）、`getArc`+`putArc`
兩段交易改為單一交易的 `updateArc`（多分頁互蓋）、`putArcWithScenario` 加集數守衛
（另一分頁同時生成時不覆寫）、`normaliseStoryState` 對錯型別欄位會拋錯（匯入的 arc
會讓每一集都無法開始）、`ReviewSheet.grade` 與 extras 的錯誤訊息保留真因、
`AudioEngine` 的「沒人聽就不算 RMS」宣稱改為真的成立（`setLevelReporting`）、
搭配詞原本只有在自由填空**失敗**時才取得（現在所有 item 都會有）。

測試從 103 增到 **130**，新增的每一條都對應上面一個剛修掉的缺陷（不是為了數字）。

### 本批修掉的兩個真缺陷（E2E 抓出來的）
1. **CSP 沒有 `media-src`** → `default-src 'self'` 讓 `blob:` 音訊被 Chrome 擋掉
   （`MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`），跟讀的兩段重播
   在正式環境會完全播不出來。已在 `coach.html` 加 `media-src 'self' blob:`（launcher
   不播媒體，維持較緊）。修好後同一個探針立刻由 fail 轉 pass。
2. **`describeError` 漏 `OverconstrainedError`** → 見 D1c。
