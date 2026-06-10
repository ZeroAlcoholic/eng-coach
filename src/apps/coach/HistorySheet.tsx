// Past-session recaps — the data was always saved, this finally makes it
// readable. Opened from the「練習 N 次」stat chip; newest first; tap a session
// to expand its recap, and the transcript on demand inside that.

import { useEffect, useState } from "react";

import { scanSessionsDesc } from "../../kernel/db";
import type { Scenario, SessionRecord, TargetLanguage } from "../../kernel/types";
import { band } from "./progress";
import { Sheet } from "./Sheet";

const PAGE = 50; // newest 50 of this language — bounded read, not the whole store

function when(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistorySheet(props: {
  lang: TargetLanguage;
  scenarios: Scenario[];
  onClose: () => void;
}) {
  // "error" is its own state: rendering a load failure as「還沒有練習紀錄」
  // would read as data loss — the scariest possible lie in a local-first app.
  const [sessions, setSessions] = useState<SessionRecord[] | null | "error">(null);
  const [open, setOpen] = useState<string | null>(null); // expanded session id
  const [showTx, setShowTx] = useState<string | null>(null); // transcript shown for id

  useEffect(() => {
    // Newest-first index scan, stopping at PAGE matches — never loads the whole
    // store. Like ReviewSheet, the sheet snapshots on open (it remounts each
    // time), so the one-shot effect is intentional.
    const byId = new Map(props.scenarios.map((sc) => [sc.id, sc]));
    const acc: SessionRecord[] = [];
    scanSessionsDesc((rec) => {
      const sc = byId.get(rec.scenarioId);
      // Current language only; sessions whose scenario was deleted stay visible
      // (their language is unknowable, and hiding saved work would read as loss).
      if (!sc || sc.targetLanguage === props.lang) acc.push(rec);
      return acc.length < PAGE;
    })
      .then(() => setSessions(acc))
      .catch(() => setSessions("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleOf = (s: SessionRecord) => props.scenarios.find((sc) => sc.id === s.scenarioId);
  const mine = Array.isArray(sessions) ? sessions : [];

  return (
    <Sheet title={`練習紀錄（${mine.length}）`} onClose={props.onClose}>
      {sessions === null && <p className="muted">載入中…</p>}
      {sessions === "error" && <p className="notice">⚠ 紀錄載入失敗 — 資料還在，請關閉後再試。</p>}
      {Array.isArray(sessions) && mine.length === 0 && <p className="muted">還沒有練習紀錄。</p>}
      {mine.map((s) => {
        const sc = titleOf(s);
        const expanded = open === s.id;
        const r = s.review;
        return (
          <div key={s.id} className="card" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="history-row"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : s.id)}
            >
              <span className="grow" style={{ textAlign: "left" }}>
                <b>{sc?.title ?? "（情境已刪除）"}</b>
                <span className="muted" style={{ display: "block" }}>
                  {when(s.startedAt)} · {s.transcript.length} 句
                </span>
              </span>
              {r?.cefr && <span className="pill pill--neutral">CEFR {r.cefr}</span>}
            </button>
            {expanded && (
              <div style={{ marginTop: 10 }}>
                {r?.subscores && (
                  <p className="muted" style={{ marginTop: 0 }}>
                    文法 {band(r.subscores.grammar)}・詞彙 {band(r.subscores.vocab)}・流暢{" "}
                    {band(r.subscores.fluency)}・互動 {band(r.subscores.interaction)}
                  </p>
                )}
                {r?.reviewZh && <p className="muted">{r.reviewZh}</p>}
                {r?.objectivesMet?.map((o, i) => (
                  <div key={i} className="muted">
                    {o.met ? "✅" : "⬜"} {o.objective}
                  </div>
                ))}
                {r?.wins?.map((w, i) => (
                  <div key={`w${i}`} className="muted">
                    👍 {w}
                  </div>
                ))}
                {r?.fixes?.map((f, i) => (
                  <div key={`f${i}`} className="muted">
                    🔧 {f}
                  </div>
                ))}
                {!r && <p className="muted">（這場沒有分析結果，只有逐字稿）</p>}
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginTop: 8 }}
                  onClick={() => setShowTx(showTx === s.id ? null : s.id)}
                >
                  {showTx === s.id ? "收起逐字稿" : "看逐字稿"}
                </button>
                {showTx === s.id && (
                  <div className="transcript" style={{ marginTop: 10 }}>
                    {s.transcript.map((t, i) => (
                      <div key={i} className={`turn ${t.who === "user" ? "turn--you" : "turn--coach"}`}>
                        <span className="turn-who">{t.who === "user" ? "你" : "教練"}</span>
                        <span className="turn-text">{t.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Sheet>
  );
}
