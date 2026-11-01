// I3 — who you are, who the other side is, and what this scene asks of you,
// shown before the learner opens their mouth. Reads only existing Scenario
// fields. Before the session it is always open; live it folds to one row the
// learner can open again, and that choice is remembered (prefs.taskCardOpen).

import type { Scenario } from "../../kernel/types";

export const TASK_CARD_SHOWN = 3;

/** Open before the session; live, only when the learner chose to keep it open. */
export function taskCardExpanded(live: boolean, pref: boolean | undefined): boolean {
  return !live || pref === true;
}

/** The pref after one tap on the live card's toggle. */
export const toggledTaskCardPref = (pref: boolean | undefined): boolean => !taskCardExpanded(true, pref);

type CardScenario = Pick<Scenario, "title" | "coachRole" | "userRole" | "objectives" | "targetPhrases">;

export function TaskCard(props: { scenario: CardScenario; expanded: boolean; onToggle?: () => void }) {
  const { scenario: s, expanded } = props;
  const objectives = s.objectives.slice(0, TASK_CARD_SHOWN);
  const moreObjectives = s.objectives.length - objectives.length;
  const phrases = s.targetPhrases.slice(0, TASK_CARD_SHOWN);
  const toggle = props.onToggle && (
    <button className="btn btn--ghost btn--sm" onClick={props.onToggle} aria-expanded={expanded}>
      {expanded ? "收起 ▴" : "展開 ▾"}
    </button>
  );

  if (!expanded) {
    return (
      <div className="card row" style={{ margin: "8px 0", alignItems: "center" }}>
        {/* One line, cut with an ellipsis: folded, the card must not take a second row. */}
        <span className="grow" style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          📋 任務：{objectives[0] ?? s.title}
        </span>
        {toggle}
      </div>
    );
  }
  // Compact on purpose: on a 390×844 phone the whole card must fit above the
  // fold together with the title, so type is a step smaller and lists are tight.
  const list = { margin: "2px 0 0", paddingLeft: 18, lineHeight: 1.4 } as const;
  const label = { marginTop: 6, fontSize: "0.9em" } as const;
  return (
    <div className="card" style={{ margin: "8px 0", fontSize: "0.9em", lineHeight: 1.45 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <strong className="grow">📋 這場的任務</strong>
        {toggle}
      </div>
      {s.userRole && <p style={{ margin: "4px 0 0" }}>你扮演：{s.userRole}</p>}
      {s.coachRole && <p style={{ margin: "2px 0 0" }}>對方：{s.coachRole}</p>}
      {objectives.length > 0 && (
        <>
          <div className="muted" style={label}>這場要做到：</div>
          <ul style={list}>
            {objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
          {moreObjectives > 0 && <div className="muted">還有 {moreObjectives} 項</div>}
        </>
      )}
      {phrases.length > 0 && (
        <>
          <div className="muted" style={label}>可以用的句子：</div>
          <ul style={list}>
            {phrases.map((p, i) => (
              <li key={i} style={{ color: "var(--coach)" }}>
                {p}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
