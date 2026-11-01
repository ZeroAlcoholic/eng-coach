// Small form controls shared by Home's settings and the scenarios sheet.

import {
  CEFR_LEVELS,
  TARGET_LANGUAGES,
  type CEFRLevel,
  type TargetLanguage,
} from "../../kernel/types";

export function LangSelect(props: {
  value: TargetLanguage;
  onChange: (v: TargetLanguage) => void;
  id?: string;
}) {
  return (
    <select
      id={props.id}
      className="select"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as TargetLanguage)}
    >
      {TARGET_LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}（{l.hint}）
        </option>
      ))}
    </select>
  );
}

export function LevelSelect(props: {
  value: CEFRLevel;
  onChange: (v: CEFRLevel) => void;
  id?: string;
}) {
  return (
    <select
      id={props.id}
      className="select"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as CEFRLevel)}
    >
      {CEFR_LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function FileButton(props: {
  accept: string;
  label: string;
  onFile: (f: File) => void;
  small?: boolean;
}) {
  return (
    <label className={`btn btn--ghost ${props.small ? "btn--sm" : ""}`}>
      {props.label}
      <input
        type="file"
        accept={props.accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
