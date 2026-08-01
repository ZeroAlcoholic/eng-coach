// C3 — end-of-session can-do self-check. The learner rates each objective
// 「我可以…?」on a 3-state scale; we then reveal the judge's verdict beside it.
// Where self and judge diverge is the calibration signal (over/under-confidence)
// — shown gently, no score — and the rating is folded into the C1 ledger.

import { useRef, useState } from "react";

import type { ObjectiveMastery, SessionReview } from "../../kernel/types";
import { recordSelfRating } from "./objectives";

type Self = NonNullable<ObjectiveMastery["selfRating"]>;

const OPTIONS: { key: Self; label: string }[] = [
  { key: "no", label: "還不行" },
  { key: "partly", label: "勉強" },
  { key: "yes", label: "可以" },
];

// A mismatch worth a gentle nudge: thought they could but the judge disagreed,
// or sold themselves short on something the judge marked done. Exported for tests.
export function calibrationNote(self: Self, met: boolean): string | null {
  if (self === "yes" && !met) return "教練覺得這項還沒很穩 — 下次可以再練一次。";
  if (self !== "yes" && met) return "其實教練覺得你做到了 — 比你想的更好。";
  return null;
}

export function CanDoSelfCheck(props: {
  scenarioId: string;
  objectives: NonNullable<SessionReview["objectivesMet"]>;
}) {
  const [ratings, setRatings] = useState<Record<string, Self>>({});
  const [saveError, setSaveError] = useState(false);
  // recordSelfRating is a read-modify-write; two taps on the same objective in
  // flight at once would race and the earlier write could win. Serialise all
  // writes through one chain so they commit in tap order — the last tap wins and
  // the persisted selfRating always matches the visible selection.
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());

  function rate(objective: string, value: Self) {
    setRatings((r) => ({ ...r, [objective]: value }));
    writeChain.current = writeChain.current
      .catch(() => {})
      .then(() => recordSelfRating(props.scenarioId, objective, value, new Date().toISOString()))
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }

  if (!props.objectives.length) return null;

  return (
    <div className="cando" style={{ margin: "12px 0" }}>
      <div className="muted" style={{ marginBottom: 6 }}>
        這次的目標，你覺得自己可以了嗎？
      </div>
      {saveError && <p className="notice">⚠ 自我評估未能儲存，再點一次試試。</p>}
      {props.objectives.map((o, i) => {
        const chosen = ratings[o.objective];
        const note = chosen ? calibrationNote(chosen, o.met) : null;
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div>{o.objective}</div>
            <div className="row" style={{ marginTop: 4 }}>
              {OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`btn btn--sm ${chosen === opt.key ? "btn--primary" : "btn--ghost"}`}
                  aria-pressed={chosen === opt.key}
                  onClick={() => rate(o.objective, opt.key)}
                >
                  {opt.label}
                </button>
              ))}
              {chosen && (
                <span className="muted" style={{ marginLeft: 8, alignSelf: "center" }}>
                  教練：{o.met ? "達成 ✅" : "還沒 ⬜"}
                </span>
              )}
            </div>
            {note && (
              <div className="muted" style={{ marginTop: 2 }}>
                ↳ {note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
