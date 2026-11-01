// I1 — the learner's name, job and organisation type, in ⚙️. All optional; the
// coach only uses what is filled in. Saving goes through the same onProfile
// path as every other profile change.

import { useId, useState } from "react";

import { PERSONA_MAX } from "../../kernel/persona";
import type { LearnerPersona } from "../../kernel/types";

const FIELDS: { key: keyof LearnerPersona; label: string; placeholder: string }[] = [
  { key: "name", label: "教練怎麼稱呼你", placeholder: "例：Amy、小陳" },
  { key: "jobTitle", label: "你的職務（英文情境會用）", placeholder: "例：產品經理" },
  { key: "orgType", label: "公司型態（英文情境會用）", placeholder: "例：外商軟體公司" },
];

export function PersonaFields(props: { persona?: LearnerPersona; onSave: (p: LearnerPersona) => void }) {
  const [draft, setDraft] = useState<LearnerPersona>(props.persona ?? {});
  const [saved, setSaved] = useState(false);
  // The profile can change under an open sheet (a backup imported, or this
  // form's own save coming back normalised). Re-seed the draft then, or a later
  // save would write the stale values over it.
  const [seen, setSeen] = useState(props.persona);
  if (props.persona !== seen) {
    setSeen(props.persona);
    setDraft(props.persona ?? {});
  }
  const baseId = useId();
  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted" style={{ margin: "0 0 4px" }}>
        關於你（選填，每欄最多 {PERSONA_MAX} 字；日文情境只用稱呼）
      </p>
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={`${baseId}-${f.key}`}>
            {f.label}
          </label>
          <input
            id={`${baseId}-${f.key}`}
            className="input"
            maxLength={PERSONA_MAX}
            value={draft[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...draft, [f.key]: e.target.value });
            }}
          />
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => {
            props.onSave(draft);
            setSaved(true);
          }}
        >
          儲存
        </button>
        {saved && <span className="muted">✓ 已儲存</span>}
      </div>
    </div>
  );
}
