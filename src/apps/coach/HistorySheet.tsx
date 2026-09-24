// Past-session recaps — the data was always saved, this finally makes it
// readable. Opened from the「練習 N 次」stat chip; newest first; tap a session
// to expand its recap, and the transcript on demand inside that.

import { useEffect, useState } from "react";

import { scanSessionsDesc } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import type { LearnerProfile, Scenario, SessionRecord, TargetLanguage } from "../../kernel/types";
import { retryReview } from "./finalize";
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
  apiKey: string;
  lang: TargetLanguage;
  scenarios: Scenario[];
  profile: LearnerProfile;
  onlyIds?: string[] | null; // opened from a readout: show just its source sessions
  onChanged: () => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const only = props.onlyIds && !showAll ? new Set(props.onlyIds) : null;
  // "error" is its own state: rendering a load failure as「還沒有練習紀錄」
  // would read as data loss — the scariest possible lie in a local-first app.
  const [sessions, setSessions] = useState<SessionRecord[] | null | { error: string }>(null);
  const [open, setOpen] = useState<string | null>(null); // expanded session id
  const [showTx, setShowTx] = useState<string | null>(null); // transcript shown for id
  const [retrying, setRetrying] = useState<string | null>(null); // session id being re-judged
  const [retryNote, setRetryNote] = useState<Record<string, string>>({});

  // A session the learner spoke in but that has no review can be judged again.
  // The stored record is updated in place so the row flips to a recap.
  async function retry(s: SessionRecord, sc: Scenario) {
    if (retrying) return;
    setRetrying(s.id);
    try {
      const judge = await retryReview(props.apiKey, { session: s, scenario: sc, profile: props.profile });
      if (judge.kind === "review") {
        setSessions((prev) =>
          Array.isArray(prev) ? prev.map((x) => (x.id === s.id ? { ...x, review: judge.review, judgeUnavailable: undefined } : x)) : prev,
        );
        props.onChanged();
      } else {
        setRetryNote((m) => ({ ...m, [s.id]: `仍無法評量：${judge.reason}` }));
      }
    } catch (e) {
      setRetryNote((m) => ({ ...m, [s.id]: `重試失敗：${describeError(e)}` }));
    } finally {
      setRetrying(null);
    }
  }

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
      .catch((e) => setSessions({ error: describeError(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleOf = (s: SessionRecord) => props.scenarios.find((sc) => sc.id === s.scenarioId);
  const all = Array.isArray(sessions) ? sessions : [];
  const mine = only ? all.filter((s) => only.has(s.id)) : all;

  return (
    <Sheet title={`練習紀錄（${mine.length}）`} onClose={props.onClose}>
      {only && (
        <p className="muted" style={{ marginTop: 0 }}>
          只顯示這個讀數的來源（{mine.length} 場）。{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowAll(true)}>
            顯示全部
          </button>
        </p>
      )}
      {sessions === null && <p className="muted">載入中…</p>}
      {sessions !== null && !Array.isArray(sessions) && (
        <p className="notice">⚠ 紀錄載入失敗（{sessions.error}）— 資料還在，請關閉後再試。</p>
      )}
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
                {!r && (
                  <p className="muted">
                    {s.kind === "micro"
                      ? "（加練片段，只有逐字稿）"
                      : s.judgeUnavailable
                        ? `評量未完成：${describeError(s.judgeUnavailable)}`
                        : "（這場沒有分析結果，只有逐字稿）"}
                  </p>
                )}
                {!r && s.kind !== "micro" && sc && props.apiKey && s.transcript.some((t) => t.who === "user") && (
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ marginRight: 8 }}
                    disabled={retrying !== null}
                    onClick={() => void retry(s, sc)}
                  >
                    {retrying === s.id ? "評量中…" : "重試評量"}
                  </button>
                )}
                {retryNote[s.id] && <p className="notice">{retryNote[s.id]}</p>}
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
