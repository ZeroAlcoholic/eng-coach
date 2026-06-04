// 工具首頁：列出共用同一份資料的純網頁工具。目前只有口說教練；單字卡 / 文法
// 之後可插進同一個 IndexedDB，零重構。

import { useEffect, useState } from "react";

import { listItems, listScenarios, listSessions } from "../../kernel/db";

interface Counts {
  scenarios: number;
  items: number;
  sessions: number;
}

export function Launcher() {
  const [counts, setCounts] = useState<Counts>({ scenarios: 0, items: 0, sessions: 0 });

  useEffect(() => {
    // 初次讀取（IndexedDB，非同步）；失敗就維持 0，不中斷畫面。
    void Promise.all([listScenarios(), listItems(), listSessions()])
      .then(([sc, it, se]) => setCounts({ scenarios: sc.length, items: it.length, sessions: se.length }))
      .catch((e) => console.warn("讀取資料失敗", e));
  }, []);

  return (
    <main className="app">
      <h1>
        <span style={{ color: "var(--primary)" }}>🌲</span> 學習工具
      </h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>
        純網頁、無伺服器。所有工具共用這台裝置上的資料。
      </p>

      <a href="coach.html" className="tile">
        <div className="tile-title">🎙️ 口說教練</div>
        <div className="muted" style={{ marginTop: 4 }}>
          英文 / 日文 口說練習 — {counts.scenarios} 個情境、{counts.sessions} 次練習
        </div>
      </a>

      <div className="tile tile--soon">
        <div className="tile-title">🃏 單字卡</div>
        <div className="muted" style={{ marginTop: 4 }}>
          即將推出 — 以你的 {counts.items} 個學過詞彙做間隔複習
        </div>
      </div>

      <div className="tile tile--soon">
        <div className="tile-title">📐 文法</div>
        <div className="muted" style={{ marginTop: 4 }}>
          即將推出
        </div>
      </div>
    </main>
  );
}
