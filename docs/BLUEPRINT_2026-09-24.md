# eng-coach 藍圖 v3（2026-09-24）— 三階段、每階段一句 GOAL

基準：`main` HEAD `94ad8d0`；baseline **lint ✓ tsc ✓ vitest 130/130 ✓**（2026-09-24 22:39 實跑）。
前置：`docs/eng-dialogue-coach-diagnostic-2026-09-23.md`。本文件取代其第 7 節。

## 0. 已查證事實（每條有探針）

| 事實 | 探針 |
|---|---|
| 診斷 F1–F5／U1–U3 在 HEAD 全部成立 | 逐條讀原始碼 |
| Live 純音訊 session 上限 15 分、連線約 10 分、到期前送 `GoAway{timeLeft}`；handle 終止後 2 小時有效 | 官方 session-management（2026-09-15） |
| `src/` 無 `goAway`／`contextWindowCompression`；一般斷線只 teardown（`Practice.tsx:263`） | grep 零命中 |
| `gemini-3.1-flash-live-preview` 官方 **legacy**；`gemini-3.8-live`、`gemini-3.8-flash` stable | 官方 models 頁（2026-09-23） |
| 本 key 看得到 `gemini-3.8-live`／`gemini-3.8-flash`（bidi／generateContent） | `models.list` 零 token 實跑 |
| SDK 2.7.0 有 `contextWindowCompression{slidingWindow}`、`goAway{timeLeft}`、`proactivity`、`enableAffectiveDialog`；**無** `interactionStatus` | `dist/genai.d.ts` |
| judge 只拿文字逐字稿卻評發音；三次全失敗回假 review（`ai.ts:215,226–232`） | 原始碼 |
| `ARCHITECTURE.md:115` 寫 judge 一次，程式三次 | 原文 |

推論：「>10 分鐘練習必斷」由上限＋無處理推得；本機無麥克風未實跑。

## 1. 不變量

零後端／BYOK／IndexedDB＋LearningPack。不加狀態機套件、DI、bus、多供應商抽象、function-call 工具群、schema 編譯器、extended-thinking、Playwright。無 streak／提醒。每項改動能陳述「改動→行為差異→結果動，因為[機制]」。範圍外發現只登錄不動手。

## 2. 相依性

```
Phase A（Session 生命週期）   Phase B（資料真實性）
   gemini-direct / AudioEngine    db / ai / finalize / pack
   / Practice                     ↕ 互相獨立，可平行
            ╲                    ╱
             Phase C（學習效度）— 依賴 A 的穩定 session 與 B 的誠實 judge、冪等 finalize
```

## 3. 三句 GOAL

### Phase A — GOAL

> **在 `gemini-3.8-live` 上，讓一場練習的長度、開始、停止與「換你說」的時機，完全由使用者與真實資源狀態決定，而不由連線上限、模型完成訊號或啟動中的競態決定。**
> 做法邊界：把 client／engine／generation 的所有權從 `Practice` 抽進單一 owner（hook 或類別，不加套件）；transport 處理 `goAway`＋`contextWindowCompression` 並以既有 `resumeHandle` 自動續接一次，對外只多一個事件；`AudioEngine` 啟動失敗自清理並提供播放清空事件；phase 為 `connecting→awaiting-mic→live→stopping→saved→(analysing|analysis-failed)`，任何時刻可停，`saved` 即可離開；開 `proactiveAudio`＋`affectiveDialog` 各自獨立 flag，不調 prompt；3.1 經 override 可回退。
> 完成判定：注入 `goAway{5s}` 後 sessionId／草稿／逐字稿連續；在 connect／getUserMedia／worklet 任一階段 Stop、unmount、拒權後無殘留 track／AudioContext／socket，舊 callback 不污染新 session；最後 chunk 同包 turnComplete、0.85 倍速、barge-in 三案提示不提前；lint／tsc／vitest 全綠。真機 12 分鐘連續對話＝blocked 待麥克風，明說。

### Phase B — GOAL

> **讓每一筆寫進 IndexedDB、顯示在畫面、匯入自備份的資料都是真的：「已儲存」等於 transaction 已 commit，評量只宣稱文字逐字稿能證明的事，同一 session 重做收尾是 no-op，備份不合法就整包拒絕。**
> 做法邊界：`db.run` 在 `tx.oncomplete` 才 resolve（對齊已正確的 `putItems`）；`summariseSession` 回傳 `Review | Unavailable` 兩個型別，prompt 移除發音（發音留給 Live 回合），`example` 須命中學習者 turn，每個 AI 能力以最小 validator 取代 `as T`，History 可重試評量；`SessionRecord.finalize` 步驟帳＋items 帶 `sourceSessionId`，profile 寫前讀最新；`importPack` 入口 `unknown`，全驗才寫並回報「新增／覆蓋」摘要；文字模型以 6 份 fixture screening 後升 `gemini-3.8-flash`，同組 fixture 決定 judge 取樣 1 次或 3 次；`ARCHITECTURE`／`ROADMAP` 同步。
> 完成判定：`onsuccess` 後強制 abort → reject 且草稿存活；三次全失敗／部分成功／cefr 非法／分數超界／example 不存在／只有教練說話六案皆不寫入數字；finalize 兩次、清草稿失敗恢復、兩分頁競爭下詞卡與 attempts 只計一次；五種無效 pack 皆不改有效資料；舊資料無新欄位仍可讀；lint／tsc／vitest 全綠。screening 用詞只准「晉級／淘汰」。

### Phase C — GOAL（依賴 A＋B）

> **讓使用者在 Home 看得到三個零 API、可追回來源 session 的進展讀數——無提示 can-do 達成率、教過 chunk 的主動使用率、錯誤型別復發率——並在每集結尾只給一個焦點、可立刻再練 90 秒。**
> 做法邊界：ledger 加 `aided`（該 turn 前有無 hint／翻譯／建議回覆）；集尾以純函式比對 due items 是否出現在學習者逐字稿寫入 `LearnedItem.uses`；E1 tally 直接用；讀數只以小趨勢符號呈現，不做儀表板；微 session 走同一 finalize、`kind:"micro"`、不進 CEFR EWMA；焦點優先序「阻礙意義 > 復發 > 未達 can-do」；順手把 `Sheet` 換成原生 `<dialog>.showModal()`。
> 完成判定：三個讀數以 fixtures 手算對得上且可點回 session；微 session 不改 level、可跳過、無提醒；Tab 不逃出 dialog、Esc 關閉、還焦原鈕、Lighthouse a11y 100；lint／tsc／vitest 全綠。

## 4. 驗收層級與回報

| 層級 | 能證明 | 適用 |
|---|---|---|
| vitest | 純函式、交易、validator、去重、讀數 | B 全部、C 讀數 |
| Chrome 整合（真 IndexedDB；transport／audio 注入替身） | 生命週期、取消、GoAway 續接、phase 順序 | A 全部、C dialog |
| 真 Live＋裝置（**需授權；本機無麥克風**） | 12 分鐘不中斷、首句延遲、proactive audio | A 最終、C 微 session |

替身層只准說「本機流程正確」。每 Phase 回報六標記（completed／partial／running／deferred／blocked／out-of-scope），blocked 前附排除清單。真機層與 8 月三項驗收債共用同一支 USB 麥克風，一次補跑。

## 5. 執行建議

A、B 各開一個分支平行進行，各自一個 PR；C 在兩者合併後開始。每個 Phase 完成後跑一輪獨立 code review（缺陷／沉默失敗／型別／測試四路），恰好一輪，通過即合併。
