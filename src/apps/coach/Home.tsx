// 首頁（介面繁中；教學內容為英 / 日）。資訊架構，行動優先：
//   1.（首次）連結 Gemini 金鑰
//   2. 你的情境 — 主內容；依「最上角語言切換」過濾，整頁跟著切避免搞錯
//   3. 範例情境 — 沒自建也能直接代入開練
//   4. 新增情境（語言由切換決定，這裡選程度）
//   5. 設定與資料

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
import { DEFAULT_SCENARIOS } from "./defaults";
import { levelSummary } from "./progress";

const LANG_LABEL: Record<TargetLanguage, string> = { en: "英文", ja: "日本語" };

export function Home(props: {
  apiKey: string;
  profile: LearnerProfile;
  scenarios: Scenario[];
  stats: { items: number; sessions: number };
  onApiKey: (key: string) => void;
  onProfile: (p: LearnerProfile) => void;
  onPractice: (s: Scenario) => void;
  onChanged: () => void;
}) {
  const { apiKey, profile, scenarios, stats } = props;
  const lang = profile.language; // the active "mode" — set by the top toggle
  const [keyInput, setKeyInput] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [building, setBuilding] = useState(false); // dedicated flag — not a magic busy string
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [showSettings, setShowSettings] = useState(false); // W5: settings tucked away
  const [showSamples, setShowSamples] = useState(false); // W5: samples collapsed once you have own
  const levelId = useId();
  const briefId = useId();

  const mine = scenarios.filter((s) => s.targetLanguage === lang);
  const samples = DEFAULT_SCENARIOS[lang].filter((d) => !scenarios.some((s) => s.id === d.id));
  const lvl = levelSummary(profile, lang); // W6
  const TREND = { up: "↗", flat: "→", down: "↘" } as const;

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      setBusy("");
    } catch (err) {
      setBusy(`錯誤：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function build() {
    if (!apiKey) return setBusy("請先連結 API 金鑰。");
    if (!brief.trim()) return setBusy("請先貼上簡報或匯入 Markdown。");
    if (building) return; // guard double-submit
    setBuilding(true);
    await withBusy("建立情境中…", async () => {
      const sc = await generateScenario(apiKey, { brief: brief.trim(), language: lang, level: profile.level });
      await putScenario(sc);
      setBrief("");
      props.onChanged();
    });
    setBuilding(false);
  }

  async function importBriefFile(file: File) {
    setBrief(await readTextFile(file));
  }

  async function importPackFile(file: File) {
    await withBusy("匯入中…", async () => {
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
        <h1 style={{ fontSize: 18 }}>🎙️ 口說教練</h1>
        <span className="grow" />
        <div className="seg" role="group" aria-label="教學語言">
          {TARGET_LANGUAGES.map((l) => (
            <button
              key={l.id}
              className={`seg-btn ${lang === l.id ? "seg-on" : ""}`}
              aria-pressed={lang === l.id}
              onClick={() => props.onProfile({ ...profile, language: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          className="btn btn--ghost btn--sm"
          aria-label="設定與資料"
          aria-pressed={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        >
          ⚙️
        </button>
      </div>

      {/* W6 — glanceable progress strip (only once there's something to show).
          Band + practice count are per-language; the vocab library is shared. */}
      {(lvl || stats.sessions > 0) && (
        <div className="statbar">
          {lvl ? (
            <>
              <span>
                {LANG_LABEL[lang]} <b>{lvl.band}</b> {TREND[lvl.trend]}
              </span>
              <span>練習 {lvl.sessions} 次</span>
            </>
          ) : (
            <span>練習 {stats.sessions} 次</span>
          )}
          <span>詞庫 {stats.items}</span>
        </div>
      )}

      {/* 1. 首次：金鑰 */}
      {!apiKey && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="label" htmlFor="key">
            連結你的 Gemini API 金鑰 — 只存在這台裝置
          </label>
          <div className="row">
            <input
              id="key"
              className="input grow"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="貼上金鑰"
            />
            <button className="btn btn--primary" onClick={() => props.onApiKey(keyInput)}>
              儲存
            </button>
          </div>
        </div>
      )}

      {/* 2. 你的情境（依語言過濾） */}
      <div className="section-title">
        你的情境 · {LANG_LABEL[lang]}（{mine.length}）
      </div>
      {mine.length === 0 && (
        <div className="card">
          <span className="muted">還沒有{LANG_LABEL[lang]}情境 — 直接試下方範例，或在最下方建立。</span>
        </div>
      )}
      {mine.map((sc) =>
        editing?.id === sc.id ? (
          <ScenarioEditor
            key={sc.id}
            value={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={async () => {
              const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
              await putScenario({ ...editing, objectives: clean(editing.objectives), targetPhrases: clean(editing.targetPhrases) });
              setEditing(null);
              props.onChanged();
            }}
          />
        ) : (
          <ScenarioCard
            key={sc.id}
            sc={sc}
            onPractice={() => props.onPractice(sc)}
            onEdit={() => setEditing(sc)}
            onExport={() => exportScenario(sc)}
            onDelete={() =>
              withBusy("", async () => {
                await deleteScenario(sc.id);
                props.onChanged();
              })
            }
          />
        ),
      )}

      {/* 3. 範例情境 — 自動展開（沒有自建時）；有自建則收合成一顆按鈕（W5 減法） */}
      {samples.length > 0 &&
        (mine.length === 0 || showSamples ? (
          <>
            <div className="section-title">範例情境 · 直接開練</div>
            {samples.map((sc) => (
              <div key={sc.id} className="card">
                <div className="scenario-title">{sc.title}</div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="pill pill--neutral">CEFR {sc.level}</span>
                  <span className="pill pill--neutral">範例</span>
                </div>
                <p className="scenario-ctx">{sc.contentContext}</p>
                <button className="btn btn--primary btn--block" onClick={() => props.onPractice(sc)}>
                  ▶ 開始練習
                </button>
              </div>
            ))}
          </>
        ) : (
          <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => setShowSamples(true)}>
            顯示範例情境（{samples.length}）
          </button>
        ))}

      {/* 4. 新增情境（語言＝目前模式） */}
      <div className="section-title">新增{LANG_LABEL[lang]}情境</div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div style={{ width: 110 }}>
            <label className="label" htmlFor={levelId}>
              程度
            </label>
            <LevelSelect id={levelId} value={profile.level} onChange={(level) => props.onProfile({ ...profile, level })} />
          </div>
        </div>
        <label className="label" htmlFor={briefId}>
          練習簡報
        </label>
        <textarea
          id={briefId}
          className="textarea"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={
            lang === "ja"
              ? "例：京都の旅館にチェックイン。予約あり、夕食の時間を相談したい。"
              : "例：和美國團隊的季度預算檢討，要為 10% 增幅辯護。"
          }
        />
        <p className="muted" style={{ margin: "8px 0" }}>
          小技巧：先在 ChatGPT／Gemini 網頁把雜亂資料整理成 Markdown，再匯入。
        </p>
        <div className="row">
          <button className="btn btn--primary grow" onClick={build} disabled={building}>
            {building ? "建立中…" : "建立情境"}
          </button>
          <FileButton accept=".md,.txt,text/markdown,text/plain" label="匯入 .md" onFile={importBriefFile} />
        </div>
      </div>

      {/* 5. 設定與資料 — tucked behind ⚙️ (W5 minimalism) */}
      {showSettings && (
        <>
          <div className="section-title">設定與資料</div>
          <div className="card">
            <div className="row">
              <button className="btn btn--ghost btn--sm" onClick={exportAll}>
                匯出資料包
              </button>
              <button className="btn btn--ghost btn--sm" onClick={exportCsv}>
                匯出單字（CSV）
              </button>
              <FileButton accept=".json,application/json" label="匯入資料包" onFile={importPackFile} small />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {apiKey && <span className="muted grow">✓ 金鑰已設定於本機</span>}
              {apiKey && (
                <button className="btn btn--ghost btn--sm" onClick={() => props.onApiKey("")}>
                  更換金鑰
                </button>
              )}
              <a className="btn btn--ghost btn--sm" href="index.html">
                ← 工具
              </a>
            </div>
          </div>
        </>
      )}

      {busy && <p className="notice">{busy}</p>}
    </main>
  );
}

// --- building blocks ---

function ScenarioCard(props: {
  sc: Scenario;
  onPractice: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { sc } = props;
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
      <button className="btn btn--primary btn--block" onClick={props.onPractice}>
        ▶ 開始練習
      </button>
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
    </div>
  );
}

function LangSelect(props: { value: TargetLanguage; onChange: (v: TargetLanguage) => void; id?: string }) {
  return (
    <select id={props.id} className="select" value={props.value} onChange={(e) => props.onChange(e.target.value as TargetLanguage)}>
      {TARGET_LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}（{l.hint}）
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
  const f = useId();

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <label className="label" htmlFor={`${f}-title`}>
        標題
      </label>
      <input id={`${f}-title`} className="input" value={s.title} onChange={(e) => set({ title: e.target.value })} />
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="grow">
          <label className="label" htmlFor={`${f}-lang`}>
            語言
          </label>
          <LangSelect id={`${f}-lang`} value={s.targetLanguage} onChange={(targetLanguage) => set({ targetLanguage })} />
        </div>
        <div style={{ width: 96 }}>
          <label className="label" htmlFor={`${f}-level`}>
            程度
          </label>
          <LevelSelect id={`${f}-level`} value={s.level} onChange={(level) => set({ level })} />
        </div>
      </div>
      <label className="label" htmlFor={`${f}-base`}>
        第一層 — 教練框架
      </label>
      <textarea id={`${f}-base`} className="textarea" value={s.baseContext} onChange={(e) => set({ baseContext: e.target.value })} />
      <label className="label" htmlFor={`${f}-content`} style={{ marginTop: 10 }}>
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
          <input id={`${f}-coach`} className="input" value={s.coachRole} onChange={(e) => set({ coachRole: e.target.value })} />
        </div>
        <div className="grow">
          <label className="label" htmlFor={`${f}-user`}>
            你扮演
          </label>
          <input id={`${f}-user`} className="input" value={s.userRole} onChange={(e) => set({ userRole: e.target.value })} />
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
      <label className="label" htmlFor={`${f}-phrases`} style={{ marginTop: 10 }}>
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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scenario";
}
