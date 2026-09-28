// The Home progress strip: three ratios with a trend mark, each tappable to the
// sessions it came from. Presentation only — every number comes from
// readouts.ts, and nothing here computes.

import type { Readout, Readouts } from "./readouts";

const TREND_MARK: Record<NonNullable<Readout["trend"]>, string> = { up: "↗", flat: "→", down: "↘" };

function ReadoutLine(props: { label: string; readout: Readout; onOpen: (ids: string[]) => void }) {
  const { readout } = props;
  if (readout.value === null) return null;
  const pct = Math.round(readout.value * 100);
  const mark = readout.trend ? TREND_MARK[readout.trend] : "";
  // An arrow is good or bad depending on the readout's direction.
  const improving = readout.trend === (readout.betterWhen === "high" ? "up" : "down");
  const worsening = readout.trend === (readout.betterWhen === "high" ? "down" : "up");
  return (
    <button type="button" className="statbtn" onClick={() => props.onOpen(readout.sourceSessionIds)}>
      {props.label} <b>{pct}%</b>{" "}
      <span style={{ color: improving ? "var(--primary)" : worsening ? "var(--warn)" : undefined }}>{mark}</span>
      <span className="muted">（{readout.n}）</span>
    </button>
  );
}

/** Nothing renders until at least one readout has a denominator. */
export function ReadoutStrip(props: { readouts: Readouts; onOpen: (ids: string[]) => void }) {
  const r = props.readouts;
  if (r.unaidedCanDo.value === null && r.chunkUse.value === null && r.focusResolution.value === null) return null;
  const f = r.focusResolution;
  return (
    <div className="statbar" style={{ marginTop: 8 }}>
      <ReadoutLine label="無提示做到" readout={r.unaidedCanDo} onOpen={props.onOpen} />
      <ReadoutLine label="教過的用出來" readout={r.chunkUse} onOpen={props.onOpen} />
      <ReadoutLine label="焦點沒再犯" readout={f} onOpen={props.onOpen} />
      {/* The split is the point: it is the only place the learner can see
          whether the 90-second drill was worth their time. Shown only when both
          halves have data, so one lone focus never reads as a comparison. */}
      {f.drilled.value !== null && f.undrilled.value !== null && (
        <span className="muted">
          有加練 {Math.round(f.drilled.value * 100)}%（{f.drilled.n}）・沒加練 {Math.round(f.undrilled.value * 100)}%（{f.undrilled.n}）
        </span>
      )}
    </div>
  );
}
