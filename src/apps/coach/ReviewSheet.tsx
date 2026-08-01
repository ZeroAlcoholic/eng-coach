// W7 — the 4-button FSRS review sheet, opened from the「複習 N」chip. One card
// at a time: front = the item, tap to reveal reading/meaning/example, grade it,
// next. Ratings persist immediately so a half-finished stack still counts.

import { useEffect, useMemo, useRef, useState } from "react";

import { putItems } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import type { LearnedItem, TargetLanguage } from "../../kernel/types";
import { generateReviewExtras } from "./ai";
import { CLOZE_BLANK, clozeFor, dueQueue, rateItem, type ReviewRating } from "./srs";
import { Sheet } from "./Sheet";

const SESSION_CAP = 20; // a stack you can finish, not a backlog wall

// C4 + E3 — three ways to prompt the SAME card. Flipping between them never
// creates a second card and never touches the schedule (see `grade`).
type Direction = "recognise" | "produce" | "cloze";

export function ReviewSheet(props: {
  apiKey: string;
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
  const [saveError, setSaveError] = useState("");
  // C4 — review direction. "recognise" = see the term, recall its meaning;
  // "produce" = see the 繁中 meaning, recall/say the term (the harder, more
  // useful direction for speaking). Same FSRS card either way — flipping the
  // prompt does NOT create a second card or double the schedule.
  const [dir, setDir] = useState<Direction>("recognise");
  // E3 — extras fetched for the current card, cached onto the item so the call
  // happens at most once per item, ever. Keyed by item id: a stale render must
  // never show one card's collocations under another.
  const [extras, setExtras] = useState<Record<string, LearnedItem>>({});
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [extrasError, setExtrasError] = useState("");
  // Ids already ATTEMPTED this session, whatever the outcome. This is the loop
  // guard, and it has to be attempt-based rather than result-based: a call that
  // succeeds but returns an unusable cloze leaves `needsExtras` true while changing
  // the item's object identity, which would re-trigger the effect and bill again,
  // forever, with the UI showing nothing but 「出題中…」.
  const attemptedRef = useRef<Set<string>>(new Set());

  const current = enrich(queue[idx], extras);

  // Switching direction must re-hide the answer: otherwise revealing in one
  // direction then flipping shows the prompt AND the term together, defeating
  // the recall test. A no-op when the direction is unchanged.
  function setDirection(next: Direction) {
    if (next === dir) return;
    setDir(next);
    setRevealed(false);
  }

  const cloze = current ? clozeFor(current) : null;
  // Fetch when anything this card needs is still missing. Note that collocations
  // are wanted even when the example already yields a free cloze — otherwise
  // 「常一起用」 could only ever appear for items whose example failed to match.
  const id = current?.id;
  const needsExtras = !!current && dir === "cloze" && (!cloze || !current.collocations?.length);

  useEffect(() => {
    if (!id || !needsExtras || !props.apiKey) return;
    if (attemptedRef.current.has(id)) return;
    attemptedRef.current.add(id);
    setLoadingExtras(true);
    setExtrasError("");
    void generateReviewExtras(props.apiKey, { item: current, blank: CLOZE_BLANK })
      .then((got) => {
        const enriched: LearnedItem = {
          ...current,
          cloze: got.cloze || current.cloze,
          collocations: got.collocations.length ? got.collocations : current.collocations,
        };
        setExtras((m) => ({ ...m, [id]: enriched }));
        // Persist so the next review of this item costs nothing. Genuinely
        // best-effort: the extras are already on screen, and a failed write only
        // means we'd fetch again in a later session.
        void putItems([enriched]).then(props.onChanged).catch(() => {});
      })
      // Keep the REAL cause: an invalid key, being offline or a 429 are all
      // user-fixable and none of them are a property of this card.
      .catch((e) => setExtrasError(describeError(e)))
      .finally(() => setLoadingExtras(false));
    // `props.onChanged` is deliberately NOT a dependency: CoachApp recreates it on
    // every render, and depending on it would re-run this on unrelated reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, needsExtras, props.apiKey]);

  async function grade(rating: ReviewRating) {
    if (!current || busy) return;
    setBusy(true);
    try {
      // ONE card regardless of direction: rateItem advances the item's single FSRS
      // card, so 認／用／填空 are three prompts over one schedule, never three.
      await putItems([rateItem(current, rating, new Date())]);
      props.onChanged();
      setSaveError("");
      setRevealed(false);
      setIdx((i) => i + 1);
    } catch (e) {
      // Don't advance past a write we KNOW failed — grading into the void would
      // turn the whole review session into theater. Same card, retry. KEEP the
      // cause: on a quota error or an IndexedDB version clash from another tab,
      // re-tapping can never work, and only the message says why.
      setSaveError(describeError(e));
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
          {saveError && <p className="notice">⚠ 這張未能儲存，請再選一次：{saveError}</p>}
          <div className="seg" role="group" aria-label="複習方向" style={{ marginBottom: 12 }}>
            <button
              className={`seg-btn ${dir === "recognise" ? "seg-on" : ""}`}
              aria-pressed={dir === "recognise"}
              onClick={() => setDirection("recognise")}
            >
              認（看詞→想意思）
            </button>
            <button
              className={`seg-btn ${dir === "produce" ? "seg-on" : ""}`}
              aria-pressed={dir === "produce"}
              onClick={() => setDirection("produce")}
            >
              用（看意思→說詞）
            </button>
            <button
              className={`seg-btn ${dir === "cloze" ? "seg-on" : ""}`}
              aria-pressed={dir === "cloze"}
              onClick={() => setDirection("cloze")}
            >
              填空
            </button>
          </div>
          <div className="review-front">
            {dir === "recognise"
              ? current.text
              : dir === "produce"
                ? current.meaning
                : (cloze ??
                  (loadingExtras
                    ? "出題中…"
                    : extrasError
                      ? `出不了填空題：${extrasError}`
                      : !props.apiKey
                        ? "填空需要金鑰（或這張的例句沒有含這個詞）。"
                        : "這張沒有可用的例句。"))}
          </div>
          {dir === "cloze" && cloze && (
            <p className="muted" style={{ marginTop: -4 }}>
              把空格說出來，再看答案。
            </p>
          )}
          {dir === "cloze" && cloze && extrasError && (
            <p className="muted">（搭配詞載入失敗：{extrasError}）</p>
          )}
          {!revealed ? (
            <button className="btn btn--ghost btn--block" onClick={() => setRevealed(true)}>
              顯示答案
            </button>
          ) : (
            <>
              <div className="review-back">
                {dir === "recognise" ? (
                  <>
                    {current.reading && <div className="muted">{current.reading}</div>}
                    <div>{current.meaning}</div>
                  </>
                ) : (
                  <>
                    <div>{current.text}</div>
                    {current.reading && <div className="muted">{current.reading}</div>}
                    {dir === "cloze" && <div className="muted">{current.meaning}</div>}
                  </>
                )}
                {current.example && <div className="muted vocab-example">{current.example}</div>}
                {/* E3 — collocations are extra EXPOSURE on reveal, not cards and
                    not answer options: nothing here is scheduled or graded. */}
                {current.collocations && current.collocations.length > 0 && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    常一起用：{current.collocations.join("・")}
                  </div>
                )}
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

/** Overlay any extras fetched this session onto the queued item (the queue is a
 *  snapshot taken on open, so it can't see later writes). */
function enrich(
  item: LearnedItem | undefined,
  extras: Record<string, LearnedItem>,
): LearnedItem | undefined {
  return item ? (extras[item.id] ?? item) : undefined;
}
