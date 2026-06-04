// Home screen. Information architecture, mobile-first:
//   1. (first run) connect the Gemini key
//   2. your scenarios — the main content; Practice is a big full-width target
//   3. create a new scenario from a brief (language + level live right here)
//   4. settings / data — export, import, change key (lower priority)
// Scenario + level editing is front-and-centre; it's the most important control.

import { useId, useState } from "react";

import {
  CEFR_LEVELS,
  TARGET_LANGUAGES,
  type CEFRLevel,
  type LearnerProfile,
  type LearningPack,
  type Scenario,
  type TargetLanguage,
} from "../../kernel/types";
import { deleteScenario, putScenario } from "../../kernel/db";
import { buildPack, buildScenarioPack, downloadFile, importPack, itemsToCsv, readTextFile } from "../../kernel/pack";
import { generateScenario } from "./ai";

export function Home(props: {
  apiKey: string;
  profile: LearnerProfile;
  scenarios: Scenario[];
  onApiKey: (key: string) => void;
  onProfile: (p: LearnerProfile) => void;
  onPractice: (s: Scenario) => void;
  onChanged: () => void;
}) {
  const { apiKey, profile, scenarios } = props;
  const [keyInput, setKeyInput] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<Scenario | null>(null);
  const newLangId = useId();
  const newLevelId = useId();
  const briefId = useId();

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      setBusy("");
    } catch (err) {
      setBusy(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function build() {
    if (!apiKey) return setBusy("Connect your API key first.");
    if (!brief.trim()) return setBusy("Paste a brief or import a Markdown file first.");
    await withBusy("Building scenario…", async () => {
      const sc = await generateScenario(apiKey, {
        brief: brief.trim(),
        language: profile.language,
        level: profile.level,
      });
      await putScenario(sc);
      setBrief("");
      props.onChanged();
    });
  }

  async function importBriefFile(file: File) {
    setBrief(await readTextFile(file));
  }

  async function importPackFile(file: File) {
    await withBusy("Importing pack…", async () => {
      const pack = JSON.parse(await readTextFile(file)) as LearningPack;
      await importPack(pack);
      props.onChanged();
    });
  }

  async function exportAll() {
    const pack = await buildPack();
    downloadFile("learning-pack.json", JSON.stringify(pack, null, 2), "application/json");
  }
  async function exportCsv() {
    const pack = await buildPack();
    downloadFile("learned-items.csv", itemsToCsv(pack.items), "text/csv");
  }
  async function exportScenario(sc: Scenario) {
    const pack = await buildScenarioPack(sc);
    downloadFile(`${slug(sc.title)}.json`, JSON.stringify(pack, null, 2), "application/json");
  }

  return (
    <main className="app">
      <div className="topbar">
        <h1 style={{ fontSize: 18 }}>🎙️ Speaking Coach</h1>
        <span className="grow" />
        <a className="btn btn--ghost btn--sm" href="index.html">
          ← Tools
        </a>
      </div>

      {/* 1. first-run key */}
      {!apiKey && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="label" htmlFor="key">
            Connect your Gemini API key — stored only on this device
          </label>
          <div className="row">
            <input
              id="key"
              className="input grow"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="paste key"
            />
            <button className="btn btn--primary" onClick={() => props.onApiKey(keyInput)}>
              Save
            </button>
          </div>
        </div>
      )}

      {/* 2. scenarios */}
      <div className="section-title">Your scenarios ({scenarios.length})</div>
      {scenarios.length === 0 && (
        <div className="card">
          <span className="muted">No scenarios yet — create your first one below ↓</span>
        </div>
      )}
      {scenarios.map((sc) =>
        editing?.id === sc.id ? (
          <ScenarioEditor
            key={sc.id}
            value={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={async () => {
              const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
              await putScenario({
                ...editing,
                objectives: clean(editing.objectives),
                targetPhrases: clean(editing.targetPhrases),
              });
              setEditing(null);
              props.onChanged();
            }}
          />
        ) : (
          <div key={sc.id} className="card">
            <div className="scenario-title">{sc.title}</div>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="pill pill--neutral">{sc.targetLanguage.toUpperCase()}</span>
              <span className="pill pill--neutral">CEFR {sc.level}</span>
            </div>
            <p className="scenario-ctx">{sc.contentContext}</p>
            {sc.progressNote && (
              <p className="muted" style={{ margin: "0 0 10px" }}>
                ↪ {sc.progressNote}
              </p>
            )}
            <button className="btn btn--primary btn--block" onClick={() => props.onPractice(sc)}>
              ▶ Practice
            </button>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(sc)}>
                Edit
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => exportScenario(sc)}>
                Export
              </button>
              <span className="grow" />
              <button
                className="btn btn--ghost btn--sm"
                style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={() =>
                  withBusy("", async () => {
                    await deleteScenario(sc.id);
                    props.onChanged();
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        ),
      )}

      {/* 3. new from brief */}
      <div className="section-title">New scenario</div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="grow">
            <label className="label" htmlFor={newLangId}>
              Language
            </label>
            <LangSelect
              id={newLangId}
              value={profile.language}
              onChange={(language) => props.onProfile({ ...profile, language })}
            />
          </div>
          <div style={{ width: 96 }}>
            <label className="label" htmlFor={newLevelId}>
              Level
            </label>
            <LevelSelect
              id={newLevelId}
              value={profile.level}
              onChange={(level) => props.onProfile({ ...profile, level })}
            />
          </div>
        </div>
        <label className="label" htmlFor={briefId}>
          Brief
        </label>
        <textarea
          id={briefId}
          className="textarea"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={
            profile.language === "ja"
              ? "例：京都の旅館にチェックイン。予約あり、夕食の時間を相談したい。"
              : "e.g. Quarterly budget review with the US team; defend a 10% increase."
          }
        />
        <p className="muted" style={{ margin: "8px 0" }}>
          Tip: tidy a messy report into Markdown in ChatGPT/Gemini web, then import it.
        </p>
        <div className="row">
          <button className="btn btn--primary grow" onClick={build}>
            Build scenario
          </button>
          <FileButton accept=".md,.txt,text/markdown,text/plain" label="Import .md" onFile={importBriefFile} />
        </div>
      </div>

      {/* 4. settings / data */}
      <div className="section-title">Settings &amp; data</div>
      <div className="card">
        <div className="row">
          <button className="btn btn--ghost btn--sm" onClick={exportAll}>
            Export pack
          </button>
          <button className="btn btn--ghost btn--sm" onClick={exportCsv}>
            Export vocab (CSV)
          </button>
          <FileButton accept=".json,application/json" label="Import pack" onFile={importPackFile} small />
        </div>
        {apiKey && (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted grow">✓ Gemini key set on this device</span>
            <button className="btn btn--ghost btn--sm" onClick={() => props.onApiKey("")}>
              Change key
            </button>
          </div>
        )}
      </div>

      {busy && <p className="notice">{busy}</p>}
    </main>
  );
}

// --- building blocks ---

function LangSelect(props: { value: TargetLanguage; onChange: (v: TargetLanguage) => void; id?: string }) {
  return (
    <select id={props.id} className="select" value={props.value} onChange={(e) => props.onChange(e.target.value as TargetLanguage)}>
      {TARGET_LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label} ({l.hint})
        </option>
      ))}
    </select>
  );
}

function LevelSelect(props: { value: CEFRLevel; onChange: (v: CEFRLevel) => void; id?: string }) {
  return (
    <select id={props.id} className="select" value={props.value} onChange={(e) => props.onChange(e.target.value as CEFRLevel)}>
      {CEFR_LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

function FileButton(props: { accept: string; label: string; onFile: (f: File) => void; small?: boolean }) {
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
  const f = useId(); // base id; each field derives `${f}-<name>`

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <label className="label" htmlFor={`${f}-title`}>
        Title
      </label>
      <input id={`${f}-title`} className="input" value={s.title} onChange={(e) => set({ title: e.target.value })} />
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="grow">
          <label className="label" htmlFor={`${f}-lang`}>
            Language
          </label>
          <LangSelect id={`${f}-lang`} value={s.targetLanguage} onChange={(targetLanguage) => set({ targetLanguage })} />
        </div>
        <div style={{ width: 96 }}>
          <label className="label" htmlFor={`${f}-level`}>
            Level
          </label>
          <LevelSelect id={`${f}-level`} value={s.level} onChange={(level) => set({ level })} />
        </div>
      </div>
      <label className="label" htmlFor={`${f}-base`}>
        Layer 1 — coaching frame
      </label>
      <textarea
        id={`${f}-base`}
        className="textarea"
        value={s.baseContext}
        onChange={(e) => set({ baseContext: e.target.value })}
      />
      <label className="label" htmlFor={`${f}-content`} style={{ marginTop: 10 }}>
        Layer 2 — this session's context
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
            Coach plays
          </label>
          <input id={`${f}-coach`} className="input" value={s.coachRole} onChange={(e) => set({ coachRole: e.target.value })} />
        </div>
        <div className="grow">
          <label className="label" htmlFor={`${f}-user`}>
            Learner plays
          </label>
          <input id={`${f}-user`} className="input" value={s.userRole} onChange={(e) => set({ userRole: e.target.value })} />
        </div>
      </div>
      <label className="label" htmlFor={`${f}-obj`}>
        Objectives (one per line)
      </label>
      <textarea
        id={`${f}-obj`}
        className="textarea"
        value={lines(s.objectives)}
        onChange={(e) => set({ objectives: toLines(e.target.value) })}
      />
      <label className="label" htmlFor={`${f}-phrases`} style={{ marginTop: 10 }}>
        Target phrases (one per line)
      </label>
      <textarea
        id={`${f}-phrases`}
        className="textarea"
        value={lines(s.targetPhrases)}
        onChange={(e) => set({ targetPhrases: toLines(e.target.value) })}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn btn--primary grow" onClick={props.onSave}>
          Save
        </button>
        <button className="btn btn--ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scenario";
}
