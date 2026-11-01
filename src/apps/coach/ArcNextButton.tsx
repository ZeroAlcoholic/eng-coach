// The story line's one-tap「下一集」card, shared by Home and the scenarios sheet.

import type { Arc } from "../../kernel/types";
import {
  episodeCanDos,
  nextEpisodeNumber,
  pendingEpisode,
  playedCount,
} from "./arcs";

/**
 * S2 — a story line as ONE tap. Progress is shown as episode count, never a
 * percentage or a score (no-gamification red line), and the recap deliberately
 * lives in the coach's spoken opening rather than on this card.
 */
export function ArcNextButton(props: {
  arc: Arc;
  busy: boolean;
  onPlay: () => void;
}) {
  const { arc } = props;
  const n = nextEpisodeNumber(arc);
  const played = playedCount(arc);
  // S3 — what this episode trains, in the learner's words. Only shown for an
  // episode that already exists; never a count, a percentage or a score.
  const canDos = episodeCanDos(arc, pendingEpisode(arc));
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="scenario-title">📖 {arc.title}</div>
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        第 {n} 集 · 全劇約 {arc.plannedEpisodes} 集
        {played > 0 && `（已練 ${played} 集）`}
      </p>
      {canDos.map((c) => (
        <p key={c.id} className="muted" style={{ margin: "0 0 6px" }}>
          ◦ 這集練：{c.text}
        </p>
      ))}
      <button
        className="btn btn--primary btn--block"
        onClick={props.onPlay}
        disabled={props.busy}
      >
        {props.busy ? "準備下一集…" : `▶ 下一集 · 第 ${n} 集`}
      </button>
    </div>
  );
}
