// E2 — an opt-in microphone LOUDNESS indicator.
//
// Honest scope, and the reason this is not on the orb: loudness is NOT stress and
// NOT a score. Emphasis in speech is carried mostly by pitch and duration, so a
// volume bar cannot tell you whether you stressed the right word, and dressing it
// up as "energy" would be a precision-as-illusion display. What it genuinely
// answers is the question every hands-free learner actually has — "is the mic
// hearing me at all?" — which is why it is labelled 音量 and stays OFF by default.
//
// It renders itself from a callback rather than a prop so the ~10 Hz level updates
// re-render THIS component only, never the live transcript above it.

import { useEffect, useState } from "react";

/** Bars in the rolling history strip (~1.5s at the engine's 10 Hz). */
const HISTORY = 15;
// RMS of ordinary speech sits well below 1.0, so scale before clamping or the bar
// barely moves. Anything at or above this reads as full.
const FULL_SCALE_RMS = 0.25;

export type LevelSubscribe = (listener: (rms: number) => void) => () => void;

export function LevelMeter(props: { subscribe: LevelSubscribe }) {
  const [history, setHistory] = useState<number[]>(() => Array<number>(HISTORY).fill(0));

  // `subscribe` must be a STABLE callback (Practice memoises it), otherwise this
  // would tear down and re-attach the listener on every level update.
  const { subscribe } = props;
  useEffect(
    () =>
      subscribe((rms) => {
        const level = Math.min(1, rms / FULL_SCALE_RMS);
        setHistory((prev) => [...prev.slice(1), level]);
      }),
    [subscribe],
  );

  const current = history[history.length - 1] ?? 0;
  const heard = history.some((h) => h > 0.02);

  return (
    <div className="card" style={{ width: "100%", marginTop: 8 }}>
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <span className="muted" style={{ whiteSpace: "nowrap" }}>
          音量
        </span>
        <div
          role="meter"
          aria-label="麥克風音量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(current * 100)}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 2,
            height: 24,
            flex: 1,
          }}
        >
          {history.map((h, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                flex: 1,
                height: `${Math.max(6, h * 100)}%`,
                background: h > 0.02 ? "var(--primary)" : "var(--line, #333)",
                borderRadius: 2,
                transition: "height 90ms linear",
              }}
            />
          ))}
        </div>
      </div>
      <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
        {heard ? "麥克風收得到你的聲音。" : "還沒收到聲音 — 說一句話看看。"}
        這是音量，不是重音也不是分數。
      </p>
    </div>
  );
}
