// U1 — everything that is not the one main action: the learner's own
// scenarios, the samples and demo story lines, and the form that builds a new
// one. Moved out of Home's first screen into a sheet; every handler and every
// piece of form state stays in Home and comes in through props, so closing the
// sheet loses nothing (a half-typed brief is still there when it reopens).

import { useId, useState } from "react";

import type {
  Arc,
  CEFRLevel,
  Scenario,
  TargetLanguage,
} from "../../kernel/types";
import { ArcNextButton } from "./ArcNextButton";
import type { DemoArc } from "./arcs";
import { FileButton, LangSelect, LevelSelect } from "./formControls";
import { Sheet } from "./Sheet";

export interface ScenariosSheetProps {
  lang: TargetLanguage;
  langLabel: string;
  onClose: () => void;
  busy: string; // Home's status line, shown here too (the page behind is covered)
  // other unfinished story lines (the primary one is on Home)
  otherArcs: Arc[];
  advancing: string | null;
  onPlayArc: (a: Arc) => void;
  // the learner's own scenarios
  mine: Scenario[];
  editing: Scenario | null;
  onEditChange: (s: Scenario | null) => void;
  onSaveEdit: () => void;
  onPractice: (s: Scenario) => void;
  onExport: (s: Scenario) => void;
  onDelete: (s: Scenario) => void;
  // samples and demo story lines
  samples: Scenario[];
  demoArcs: DemoArc[];
  showSamples: boolean;
  onShowSamples: () => void;
  onStartDemo: (d: DemoArc) => void;
  // building a new one
  level: CEFRLevel;
  onLevel: (l: CEFRLevel) => void;
  brief: string;
  onBrief: (t: string) => void;
  serial: boolean;
  onSerial: (b: boolean) => void;
  building: boolean;
  onBuild: () => void;
  onCopyPrompt: () => void;
  onImportBrief: (f: File) => void;
  onSurpriseSerial: () => void;
}

export function ScenariosSheet(props: ScenariosSheetProps) {
  const levelId = useId();
  const briefId = useId();
  return (
    <Sheet title="情境與新增" onClose={props.onClose}>
      {props.busy && <p className="notice">{props.busy}</p>}
      {props.otherArcs.map((a) => (
        <ArcNextButton
          key={a.id}
          arc={a}
          busy={props.advancing === a.id}
          onPlay={() => props.onPlayArc(a)}
        />
      ))}
      {/* 換個新劇情 — the story-line variant; the one-off is on Home. */}
      <button
        className="btn btn--ghost btn--block"
        style={{ marginTop: 8 }}
        onClick={props.onSurpriseSerial}
        disabled={props.building}
      >
        🎲 {props.building ? "準備中…" : "隨機抽一條連續劇（約 6 集）"}
      </button>

      {/* 2. 你的情境（依語言過濾） */}
      <div className="section-title">
        你的情境 · {props.langLabel}（{props.mine.length}）
      </div>
      {props.mine.length === 0 && (
        <div className="card">
          <span className="muted">
            還沒有{props.langLabel}情境 — 直接試下方範例，或在最下方建立。
          </span>
        </div>
      )}
      {props.mine.map((sc) =>
        props.editing?.id === sc.id ? (
          <ScenarioEditor
            key={sc.id}
            value={props.editing}
            onChange={props.onEditChange}
            onCancel={() => props.onEditChange(null)}
            onSave={props.onSaveEdit}
          />
        ) : (
          <ScenarioCard
            key={sc.id}
            sc={sc}
            onPractice={() => props.onPractice(sc)}
            onEdit={() => props.onEditChange(sc)}
            onExport={() => props.onExport(sc)}
            onDelete={() => props.onDelete(sc)}
          />
        ),
      )}

      {/* 3. 範例情境 — 自動展開（沒有自建時）；有自建則收合成一顆按鈕（W5 減法） */}
      {(props.samples.length > 0 || props.demoArcs.length > 0) &&
        (props.mine.length === 0 || props.showSamples ? (
          <>
            {/* S4 — demo arcs sit above the one-off samples: a story line is the
            better first experience, and there is at most one per language. */}
            {props.demoArcs.map((demo) => (
              <div key={demo.id} className="card" style={{ marginTop: 8 }}>
                <div className="scenario-title">📖 {demo.title}</div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="pill pill--neutral">CEFR {demo.level}</span>
                  <span className="pill pill--neutral">
                    約 {demo.plannedEpisodes} 集
                  </span>
                  <span className="pill pill--neutral">示範</span>
                </div>
                <p className="scenario-ctx">{demo.premise}</p>
                <button
                  className="btn btn--primary btn--block"
                  onClick={() => props.onStartDemo(demo)}
                  disabled={props.advancing === demo.id}
                >
                  {props.advancing === demo.id
                    ? "準備第 1 集…"
                    : "▶ 從第 1 集開始"}
                </button>
              </div>
            ))}
            <div className="section-title">範例情境 · 直接開練</div>
            {props.samples.map((sc) => (
              <div key={sc.id} className="card">
                <div className="scenario-title">{sc.title}</div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="pill pill--neutral">CEFR {sc.level}</span>
                  <span className="pill pill--neutral">範例</span>
                </div>
                <p className="scenario-ctx">{sc.contentContext}</p>
                <button
                  className="btn btn--primary btn--block"
                  onClick={() => props.onPractice(sc)}
                >
                  ▶ 開始練習
                </button>
              </div>
            ))}
          </>
        ) : (
          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 8 }}
            onClick={props.onShowSamples}
          >
            顯示範例（{props.samples.length + props.demoArcs.length}）
          </button>
        ))}

      {/* 4. 新增情境（語言＝目前模式） */}
      <div className="section-title">新增{props.langLabel}情境</div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div style={{ width: 110 }}>
            <label className="label" htmlFor={levelId}>
              程度
            </label>
            <LevelSelect
              id={levelId}
              value={props.level}
              onChange={props.onLevel}
            />
          </div>
        </div>
        <label className="label" htmlFor={briefId}>
          練習簡報
        </label>
        <textarea
          id={briefId}
          className="textarea"
          value={props.brief}
          onChange={(e) => props.onBrief(e.target.value)}
          placeholder={
            props.lang === "ja"
              ? "例：京都の旅館にチェックイン。予約あり、夕食の時間を相談したい。"
              : "例：和美國團隊的季度預算檢討，要為 10% 增幅辯護。"
          }
        />
        {/* The hand-off to another assistant is one tap: copy a prompt that asks
        for exactly the brief shape the generator extracts best from. */}
        <div className="row" style={{ margin: "8px 0", alignItems: "center" }}>
          <span className="muted grow">
            有簡報、報告或會議通知？先請 ChatGPT／Gemini
            整理成練習簡報再貼回來。
          </span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={props.onCopyPrompt}
          >
            複製提示詞
          </button>
        </div>
        {/* S2 — one control, not a second screen: the same brief either makes a
        one-off scenario or a multi-episode story line. */}
        <label
          className="row"
          style={{ marginBottom: 10, gap: 8, alignItems: "center" }}
        >
          <input
            type="checkbox"
            checked={props.serial}
            onChange={(e) => props.onSerial(e.target.checked)}
          />
          <span className="muted">
            連續劇 — 一條約 6 集、會接續下去的故事線
          </span>
        </label>
        <div className="row">
          <button
            className="btn btn--primary grow"
            onClick={props.onBuild}
            disabled={props.building}
          >
            {props.building
              ? props.serial
                ? "編寫中…"
                : "建立中…"
              : props.serial
                ? "建立連續劇"
                : "建立情境"}
          </button>
          <FileButton
            accept=".md,.txt,text/markdown,text/plain"
            label="匯入 .md"
            onFile={props.onImportBrief}
          />
        </div>
      </div>
    </Sheet>
  );
}

function ScenarioCard(props: {
  sc: Scenario;
  onPractice: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { sc } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="card">
      <div className="scenario-title">{sc.title}</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill pill--neutral">CEFR {sc.level}</span>
      </div>
      <p className="scenario-ctx">{sc.contentContext}</p>
      {sc.progressNote && (
        <p className="muted" style={{ margin: "0 0 10px" }}>
          ↪ {sc.progressNote}
        </p>
      )}
      <button
        className="btn btn--primary btn--block"
        onClick={props.onPractice}
      >
        ▶ 開始練習
      </button>
      {/* U1 — the rare actions fold behind ⋯ so each card has one obvious tap. */}
      <div className="row" style={{ marginTop: 8 }}>
        <span className="grow" />
        <button
          className="btn btn--ghost btn--sm"
          aria-expanded={menuOpen}
          aria-label="更多動作"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ⋯
        </button>
      </div>
      {menuOpen && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={props.onEdit}>
            編輯
          </button>
          <button className="btn btn--ghost btn--sm" onClick={props.onExport}>
            匯出
          </button>
          <span className="grow" />
          <button
            className="btn btn--ghost btn--sm"
            style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={props.onDelete}
          >
            刪除
          </button>
        </div>
      )}
    </div>
  );
}

function ScenarioEditor(props: {
  value: Scenario;
  onChange: (s: Scenario) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const s = props.value;
  const set = (patch: Partial<Scenario>) => props.onChange({ ...s, ...patch });
  const lines = (v: string[]) => v.join("\n");
  const toLines = (t: string) => t.split("\n");
  const f = useId();

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <label className="label" htmlFor={`${f}-title`}>
        標題
      </label>
      <input
        id={`${f}-title`}
        className="input"
        value={s.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="grow">
          <label className="label" htmlFor={`${f}-lang`}>
            語言
          </label>
          <LangSelect
            id={`${f}-lang`}
            value={s.targetLanguage}
            onChange={(targetLanguage) => set({ targetLanguage })}
          />
        </div>
        <div style={{ width: 96 }}>
          <label className="label" htmlFor={`${f}-level`}>
            程度
          </label>
          <LevelSelect
            id={`${f}-level`}
            value={s.level}
            onChange={(level) => set({ level })}
          />
        </div>
      </div>
      <label className="label" htmlFor={`${f}-base`}>
        第一層 — 教練框架
      </label>
      <textarea
        id={`${f}-base`}
        className="textarea"
        value={s.baseContext}
        onChange={(e) => set({ baseContext: e.target.value })}
      />
      <label
        className="label"
        htmlFor={`${f}-content`}
        style={{ marginTop: 10 }}
      >
        第二層 — 本次情境內容
      </label>
      <textarea
        id={`${f}-content`}
        className="textarea"
        value={s.contentContext}
        onChange={(e) => set({ contentContext: e.target.value })}
      />
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="grow">
          <label className="label" htmlFor={`${f}-coach`}>
            教練扮演
          </label>
          <input
            id={`${f}-coach`}
            className="input"
            value={s.coachRole}
            onChange={(e) => set({ coachRole: e.target.value })}
          />
        </div>
        <div className="grow">
          <label className="label" htmlFor={`${f}-user`}>
            你扮演
          </label>
          <input
            id={`${f}-user`}
            className="input"
            value={s.userRole}
            onChange={(e) => set({ userRole: e.target.value })}
          />
        </div>
      </div>
      <label className="label" htmlFor={`${f}-obj`}>
        練習目標（每行一個）
      </label>
      <textarea
        id={`${f}-obj`}
        className="textarea"
        value={lines(s.objectives)}
        onChange={(e) => set({ objectives: toLines(e.target.value) })}
      />
      <label
        className="label"
        htmlFor={`${f}-phrases`}
        style={{ marginTop: 10 }}
      >
        目標語句（每行一個）
      </label>
      <textarea
        id={`${f}-phrases`}
        className="textarea"
        value={lines(s.targetPhrases)}
        onChange={(e) => set({ targetPhrases: toLines(e.target.value) })}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn--primary grow" onClick={props.onSave}>
          儲存
        </button>
        <button className="btn btn--ghost" onClick={props.onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
