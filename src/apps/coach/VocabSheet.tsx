// The vocab library, finally browsable in-app (was export-only). Opened from
// the「詞庫 N」stat chip; newest first, client-side filter, per-item delete.

import { useState } from "react";

import { deleteItem } from "../../kernel/db";
import type { LearnedItem, TargetLanguage } from "../../kernel/types";
import { Sheet } from "./Sheet";

const KIND_LABEL: Record<LearnedItem["kind"], string> = {
  word: "單字",
  phrase: "語句",
  grammar: "文法",
};

export function VocabSheet(props: {
  lang: TargetLanguage;
  items: LearnedItem[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [deleteError, setDeleteError] = useState(false);

  const needle = q.trim().toLowerCase();
  const mine = props.items
    .filter((i) => i.language === props.lang)
    .filter(
      (i) =>
        !needle ||
        i.text.toLowerCase().includes(needle) ||
        i.meaning.toLowerCase().includes(needle) ||
        (i.reading ?? "").toLowerCase().includes(needle),
    )
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));

  return (
    <Sheet title={`詞庫（${mine.length}）`} onClose={props.onClose}>
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋單字或意思…"
        aria-label="搜尋詞庫"
      />
      {deleteError && <p className="notice">⚠ 刪除失敗，請再試一次。</p>}
      {mine.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {needle ? "找不到符合的項目。" : "詞庫是空的 — 練習結束會自動收進來。"}
        </p>
      )}
      {mine.map((it) => (
        <div key={it.id} className="vocab-row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div>
              <b>{it.text}</b>
              {it.reading && <span className="muted">（{it.reading}）</span>}{" "}
              <span className="pill pill--neutral">{KIND_LABEL[it.kind]}</span>
            </div>
            <div className="muted">{it.meaning}</div>
            {it.example && <div className="muted vocab-example">{it.example}</div>}
          </div>
          <button
            className="btn btn--ghost btn--sm"
            aria-label={`刪除 ${it.text}`}
            style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={() => {
              deleteItem(it.id)
                .then(() => {
                  setDeleteError(false);
                  props.onChanged();
                })
                .catch(() => setDeleteError(true)); // row stays — data is safe
            }}
          >
            刪除
          </button>
        </div>
      ))}
    </Sheet>
  );
}
