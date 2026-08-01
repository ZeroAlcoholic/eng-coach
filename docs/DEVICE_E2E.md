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
（見 V3b、S2b-ii）。這不是程式缺陷，是本機硬體事實。

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

### S3 / S4 — criterion 於開工時補列（規則同上）
