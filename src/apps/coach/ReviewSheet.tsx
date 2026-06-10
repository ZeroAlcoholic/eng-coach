// W7 — the 4-button FSRS review sheet, opened from the「複習 N」chip. One card
// at a time: front = the item, tap to reveal reading/meaning/example, grade it,
// next. Ratings persist immediately so a half-finished stack still counts.

import { useMemo, useState } from "react";

import { putItems } from "../../kernel/db";
import type { LearnedItem, TargetLanguage } from "../../kernel/types";
import { dueQueue, rateItem, type ReviewRating } from "./srs";
import { Sheet } from "./Sheet";

const SESSION_CAP = 20; // a stack you can finish, not a backlog wall

export function ReviewSheet(props: {
  lang: TargetLanguage;
  items: LearnedItem[];
  onChanged: () => void;
  onClose: () => void;
}) {
  // Snapshot the queue once on open — rating an item must not reshuffle it.
  const queue = useMemo(
    () => dueQueue(props.items, props.lang, new Date(), SESSION_CAP),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const current = queue[idx];

  async function grade(rating: ReviewRating) {
    if (!current || busy) return;
    setBusy(true);
    try {
      await putItems([rateItem(current, rating, new Date())]);
      props.onChanged();
      setSaveError(false);
      setRevealed(false);
      setIdx((i) => i + 1);
    } catch {
      // Don't advance past a write we KNOW failed — grading into the void
      // would turn the whole review session into theater. Same card, retry.
      setSaveError(true);
    }
    setBusy(false);
  }

  return (
    <Sheet title={`複習 ${Math.min(idx + 1, queue.length)}/${queue.length}`} onClose={props.onClose}>
      {!current ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <p style={{ fontSize: 28, margin: 0 }}>🎉</p>
          <p className="muted">
            {queue.length === 0 ? "目前沒有到期的複習。" : `完成 ${queue.length} 張，今天就到這裡。`}
          </p>
          <button className="btn btn--primary" onClick={props.onClose}>
            完成
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          {saveError && <p className="notice">⚠ 這張未能儲存，請再選一次。</p>}
          <div className="review-front">{current.text}</div>
          {!revealed ? (
            <button className="btn btn--ghost btn--block" onClick={() => setRevealed(true)}>
              顯示答案
            </button>
          ) : (
            <>
              <div className="review-back">
                {current.reading && <div className="muted">{current.reading}</div>}
                <div>{current.meaning}</div>
                {current.example && <div className="muted vocab-example">{current.example}</div>}
              </div>
              <div className="review-grades">
                <button className="btn btn--ghost" disabled={busy} onClick={() => void grade("again")}>
                  再來
                </button>
                <button className="btn btn--ghost" disabled={busy} onClick={() => void grade("hard")}>
                  困難
                </button>
                <button className="btn btn--primary" disabled={busy} onClick={() => void grade("good")}>
                  記得
                </button>
                <button className="btn btn--ghost" disabled={busy} onClick={() => void grade("easy")}>
                  簡單
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
