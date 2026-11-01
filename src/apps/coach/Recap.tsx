// The end-of-session recap: what was stored, and the review. Moved out of
// Practice.tsx with U3, which changed only what the review shows by default.

import { useState } from "react";

import { describeError } from "../../kernel/errors";
import { ERROR_TYPE_LABEL, type SessionReview } from "../../kernel/types";
import { CanDoSelfCheck } from "./CanDoSelfCheck";
import type { FinalizeOutcome } from "./finalize";
import { band } from "./progress";

export function Recap(props: { outcome: FinalizeOutcome; scenarioId: string }) {
  const { outcome } = props;
  switch (outcome.kind) {
    case "micro":
      return <b>已儲存這段加練</b>;
    case "not-saved":
      return (
        <>
          <b>這場沒有儲存</b>
          <p className="muted" style={{ marginTop: 8 }}>
            逐字稿還在草稿裡，回首頁可再「分析並儲存」。原因：{outcome.reason}
          </p>
        </>
      );
    case "already":
      return (
        <>
          <b>這場已經分析並儲存過了</b>
          {outcome.review && <ReviewBody review={outcome.review} scenarioId={props.scenarioId} />}
        </>
      );
    case "in-progress":
      return (
        <>
          <b>逐字稿已儲存</b>
          <p className="muted" style={{ marginTop: 8 }}>
            這場正由另一個分頁分析中，或上次分析中斷（{new Date(outcome.claimedAt).toLocaleTimeString("zh-TW")}）。
            十分鐘後可在首頁「練習紀錄」重試評量。
          </p>
        </>
      );
    case "done":
      return (
        <>
          {outcome.judge.kind === "review" ? (
            <>
              <b>已儲存本次練習</b>
              <ReviewBody review={outcome.judge.review} scenarioId={props.scenarioId} />
            </>
          ) : (
            <>
              <b>已儲存逐字稿</b>
              <p className="muted" style={{ marginTop: 8 }}>
                {outcome.judge.retryable
                  ? `評量未完成：${describeError(outcome.judge.reason)}。等級與下次重點沒有更新；可在首頁「練習紀錄」重試評量。`
                  : `這場沒有評量：${outcome.judge.reason} 等級與下次重點沒有更新——下次試著用自己的話多說幾句。`}
              </p>
            </>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            {outcome.itemsFailed
              ? "這次沒能抽出單字／語句（下次在練習紀錄重試評量時會一起補）。"
              : `已新增 ${outcome.items} 個單字／語句到你的詞庫。`}
          </p>
          {outcome.story && !outcome.story.played && (
            <p className="notice">故事線進度沒能記錄 — 「下一集」可能會重播這一集。</p>
          )}
          {outcome.story?.played && !outcome.story.advanced && (
            <p className="muted">下一集還沒寫好；回首頁點「下一集」會再試一次。</p>
          )}
        </>
      );
    default:
      return assertNever(outcome);
  }
}

/** U3 — one focus by default: the can-do self-check, the first win and the
 *  first fix (the focus card follows in Practice). Everything else — CEFR and
 *  the four bands, both one-line reviews, the other wins and fixes, the error
 *  types, the next-time note — is one tap away under「看完整回顧」. The review
 *  data and what is stored are unchanged; only what shows by default is. */
export function ReviewBody(props: { review: SessionReview; scenarioId: string; defaultFull?: boolean }) {
  const { review } = props;
  const [full, setFull] = useState(props.defaultFull ?? false);
  const firstWin = review.wins?.[0];
  const firstFix = review.fixes?.[0];
  return (
    <>
      {review.objectivesMet && review.objectivesMet.length > 0 && (
        <CanDoSelfCheck scenarioId={props.scenarioId} objectives={review.objectivesMet} />
      )}
      {firstWin && <div className="muted">👍 {firstWin}</div>}
      {firstFix && <div className="muted">🔧 {firstFix}</div>}
      <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} aria-expanded={full} onClick={() => setFull(!full)}>
        {full ? "收起完整回顧" : "看完整回顧"}
      </button>
      {full && <ReviewDetails review={review} />}
    </>
  );
}

/** The rest of the review, shown on request. */
export function ReviewDetails(props: { review: SessionReview }) {
  const { review } = props;
  return (
    <>
      {review.cefr && <p className="muted" style={{ marginTop: 8 }}>本次 CEFR {review.cefr}</p>}
      {review.subscores && (
        <p className="muted" style={{ marginTop: 8 }}>
          文法 {band(review.subscores.grammar)}・詞彙 {band(review.subscores.vocab)}・流暢{" "}
          {band(review.subscores.fluency)}・互動 {band(review.subscores.interaction)}
        </p>
      )}
      {review.reviewZh && <p className="muted">{review.reviewZh}</p>}
      {review.reviewEn && <p className="muted">{review.reviewEn}</p>}
      {review.wins?.slice(1).map((w, i) => (
        <div key={`w${i}`} className="muted">
          👍 {w}
        </div>
      ))}
      {review.fixes?.slice(1).map((f, i) => (
        <div key={`f${i}`} className="muted">
          🔧 {f}
        </div>
      ))}
      {/* E1 — one line naming the error TYPES confirmed this session. */}
      {review.errors && review.errors.length > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          📌 這次的錯誤型態：{review.errors.map((e) => ERROR_TYPE_LABEL[e.type]).join("・")}
        </p>
      )}
      {review.progressNote && <p className="muted">↪ 下次重點：{review.progressNote}</p>}
    </>
  );
}

function assertNever(x: never): never {
  throw new Error(`unhandled outcome: ${JSON.stringify(x)}`);
}
