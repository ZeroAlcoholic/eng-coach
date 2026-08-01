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
  type Arc,
  type CEFRLevel,
  type DraftSession,
  type LearnedItem,
  type LearnerProfile,
  type LearningPack,
  type Scenario,
  type TargetLanguage,
} from "../../kernel/types";
import { clearDraft, deleteScenario, putScenario, putSession } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import { DEFAULT_LIVE_MODEL, getLiveModelOverride, setLiveModelOverride } from "../../kernel/overrides";
import {
  backupPack,
  buildScenarioPack,
  downloadFile,
  importPack,
  itemsToCsv,
  readTextFile,
} from "../../kernel/pack";
import { persistedState, type PersistState } from "../../kernel/storage";
import { generateScenario, validateApiKey } from "./ai";
import {
  advanceArc,
  isArcFinished,
  nextEpisodeGenerator,
  nextEpisodeNumber,
  pendingEpisode,
  playedCount,
  seedGenerator,
  startArc,
} from "./arcs";
import { DEFAULT_SCENARIOS } from "./defaults";
import { finalizeSession, PersistError, ResultsPersistError } from "./finalize";
import { HistorySheet } from "./HistorySheet";
import { levelSummary } from "./progress";
import { ReviewSheet } from "./ReviewSheet";
import { countDue } from "./srs";
import { VocabSheet } from "./VocabSheet";

const LANG_LABEL: Record<TargetLanguage, string> = { en: "英文", ja: "日本語" };

export function Home(props: {
  apiKey: string;
  profile: LearnerProfile;
  scenarios: Scenario[];
  arcs: Arc[]; // S1/S2 — story lines; at most ONE is ever the primary action
  items: LearnedItem[];
  sessionCount: number;
  draft: DraftSession | null; // unsaved session left by a killed tab
  lastPracticed: Scenario | null; // most recent scenario for the active language
  loadFailed: boolean; // IndexedDB load failed — empty states below would lie
  persist: PersistState; // A1 — whether the browser will keep data from eviction
  onApiKey: (key: string) => void;
  onProfile: (p: LearnerProfile) => void;
  onPractice: (s: Scenario) => void;
  onChanged: () => void;
}) {
  const { apiKey, profile, scenarios, arcs, items, sessionCount, draft } = props;
  const lang = profile.language; // the active "mode" — set by the top toggle
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false); // validating the pasted key
  const [modelInput, setModelInput] = useState(getLiveModelOverride); // ⚙️ 進階
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [building, setBuilding] = useState(false); // dedicated flag — not a magic busy string
  const [recovering, setRecovering] = useState(false); // guard double-tap on 恢復
  const [backingUp, setBackingUp] = useState(false); // guard double-tap on 備份
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [showSettings, setShowSettings] = useState(false); // W5: settings tucked away
  // props.persist arrives async from CoachApp (the mount-time request). On top of
  // that we re-read the state (without re-requesting) whenever ⚙️ opens — some
  // engines grant persistence LATER from engagement signals (PWA install, repeat
  // visits), so the initial best-effort result would otherwise leave a stale
  //「請定期備份」warning showing all session. The fresh read wins once we have it.
  const [refreshedPersist, setRefreshedPersist] = useState<PersistState | null>(null);
  const persist = refreshedPersist ?? props.persist;
  const [showSamples, setShowSamples] = useState(false); // W5: samples collapsed once you have own
  const [serial, setSerial] = useState(false); // 新增: build a story arc, not a one-off
  const [advancing, setAdvancing] = useState<string | null>(null); // arc id being advanced
  const [showOtherArcs, setShowOtherArcs] = useState(false); // progressive disclosure, not a list
  const [sheet, setSheet] = useState<"history" | "vocab" | "review" | null>(null);
  const levelId = useId();
  const briefId = useId();
  const modelId = useId();

  // Arc episodes are NOT standalone scenarios — they belong to the arc card, and
  // listing all six would bury Home under one story's episodes.
  const mine = scenarios.filter((s) => s.targetLanguage === lang && !s.arc);
  // S2 — ONE primary story action: the most recently advanced unfinished arc for
  // this language. Any others stay behind a single collapsed row (never a list).
  const liveArcs = arcs
    .filter((a) => a.targetLanguage === lang && !isArcFinished(a))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [primaryArc, ...otherArcs] = liveArcs;
  const samples = DEFAULT_SCENARIOS[lang].filter((d) => !scenarios.some((s) => s.id === d.id));
  const lvl = levelSummary(profile, lang); // W6
  const due = countDue(items, lang, new Date()); // W7
  const TREND = { up: "↗", flat: "→", down: "↘" } as const;

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      setBusy("");
    } catch (err) {
      setBusy(`錯誤：${describeError(err)}`);
    }
  }

  // Validate BEFORE saving: a typo'd key must fail here with a Chinese message,
  // not minutes later mid-practice with a raw English blob.
  async function saveKey() {
    const k = keyInput.trim();
    if (!k) return setBusy("請先貼上金鑰。");
    if (savingKey) return;
    setSavingKey(true);
    setBusy("驗證金鑰中…");
    try {
      await validateApiKey(k);
      props.onApiKey(k);
      setKeyInput("");
      setBusy("✓ 金鑰有效，已儲存在這台裝置。");
    } catch (err) {
      setBusy(`金鑰驗證失敗：${describeError(err)}`);
    }
    setSavingKey(false);
  }

  async function build() {
    if (!apiKey) return setBusy("請先連結 API 金鑰。");
    if (!brief.trim()) return setBusy("請先貼上簡報或匯入 Markdown。");
    if (building) return; // guard double-submit
    setBuilding(true);
    await withBusy(serial ? "編寫連續劇中…" : "建立情境中…", async () => {
      if (serial) {
        // S1/S2 — an arc lands with episode 1 already materialised, so the very
        // next tap is「▶ 下一集 · 第 1 集」.
        await startArc(
          { brief: brief.trim(), language: lang, level: profile.level },
          seedGenerator(apiKey),
        );
      } else {
        const sc = await generateScenario(apiKey, {
          brief: brief.trim(),
          language: lang,
          level: profile.level,
        });
        await putScenario(sc);
      }
      setBrief("");
      props.onChanged();
    });
    setBuilding(false);
  }

  // S2 — the single narrative action. advanceArc is idempotent: normally the
  // episode was already written at the end of the last one and this is a plain
  // read; if that generation failed, THIS is the retry (guard: a failure leaves
  // the arc untouched, so tapping again is always safe).
  async function playNextEpisode(arc: Arc) {
    if (!apiKey) return setBusy("請先連結 API 金鑰。");
    if (advancing) return; // guard double-tap
    setAdvancing(arc.id);
    setBusy(pendingEpisode(arc) ? "" : "正在寫下一集…");
    try {
      const sc = await advanceArc(arc.id, nextEpisodeGenerator(apiKey));
      if (!sc) {
        setBusy("這條故事線已經完結了。");
        props.onChanged();
        return;
      }
      setBusy("");
      props.onPractice(sc);
    } catch (err) {
      setBusy(`下一集還沒寫好：${describeError(err)}（再點一次即可重試）`);
    } finally {
      setAdvancing(null);
    }
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

  // A2 — one-tap backup: shares the file to Files/NAS on phones, downloads on
  // desktop. User-initiated; no nag. The download fallback lives in backupPack.
  async function backup() {
    if (backingUp) return; // guard double-tap → two share sheets / double build
    setBackingUp(true);
    setBusy("準備備份…");
    try {
      const how = await backupPack();
      setBusy(
        how === "shared"
          ? "已備份（已開啟分享，可存到「檔案」或 NAS）。"
          : how === "downloaded"
            ? "已下載備份檔 learning-pack.json。"
            : "", // cancelled — say nothing
      );
    } catch (err) {
      setBusy(`備份失敗：${err instanceof Error ? err.message : String(err)}`);
    }
    setBackingUp(false);
  }
  function exportCsv() {
    downloadFile("learned-items.csv", itemsToCsv(items), "text/csv");
  }
  async function exportScenario(sc: Scenario) {
    const pack = await buildScenarioPack(sc);
    downloadFile(`${slug(sc.title)}.json`, JSON.stringify(pack, null, 2), "application/json");
  }

  // Crash recovery — a draft means a live session never reached「停止並儲存」
  // (the tab was killed or the page reloaded). Same finalize pipeline as a
  // normal stop; without a key or scenario we still keep the raw transcript.
  async function recoverDraft() {
    if (!draft || recovering) return;
    setRecovering(true);
    const sc = scenarios.find((s) => s.id === draft.scenarioId);
    setBusy("分析上次未儲存的練習中…");
    try {
      if (sc && apiKey) {
        const out = await finalizeSession(apiKey, {
          scenario: sc,
          profile,
          sessionId: draft.id,
          startedAt: draft.startedAt,
          transcript: draft.transcript,
        });
        setBusy(`已救回上次練習：CEFR ${out.review.cefr}，新增 ${out.items} 個詞彙。`);
      } else {
        await putSession({
          id: draft.id,
          scenarioId: draft.scenarioId,
          startedAt: draft.startedAt,
          transcript: draft.transcript,
        });
        await clearDraft();
        setBusy(`已儲存逐字稿（${sc ? "未設定金鑰" : "原情境已刪除"}，未分析）。`);
      }
    } catch (err) {
      const msg = describeError(err);
      // PersistError → nothing saved, draft still here, retry is meaningful.
      // ResultsPersistError → saved AND analysed, results partially stored.
      // Anything else → the transcript IS saved; only the analysis failed.
      setBusy(
        err instanceof PersistError
          ? `儲存失敗，草稿仍保留，可再試一次：${msg}`
          : err instanceof ResultsPersistError
            ? `已救回並分析（CEFR ${err.outcome.review.cefr}），但部分結果未能寫入：${msg}`
            : `逐字稿已儲存（見「練習」紀錄），但分析失敗：${msg}`,
      );
    }
    setRecovering(false);
    props.onChanged();
  }

  async function discardDraft() {
    await clearDraft().catch(() => {});
    props.onChanged();
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
          onClick={() =>
            setShowSettings((v) => {
              if (!v) void persistedState().then(setRefreshedPersist); // refresh on open
              return !v;
            })
          }
        >
          ⚙️
        </button>
      </div>

      {props.loadFailed && (
        <p className="notice">⚠ 資料載入失敗 — 下方顯示的可能不是你的完整資料，請重新整理。</p>
      )}

      {/* W6 — glanceable progress strip (only once there's something to show).
          Band + practice count are per-language; the vocab library is shared.
          The chips are tappable: 練習 → past recaps, 詞庫 → browse, 複習 → W7. */}
      {(lvl || sessionCount > 0) && (
        <div className="statbar">
          {lvl && (
            <span>
              {LANG_LABEL[lang]} <b>{lvl.band}</b> {TREND[lvl.trend]}
            </span>
          )}
          <button type="button" className="statbtn" onClick={() => setSheet("history")}>
            練習 {lvl ? lvl.sessions : sessionCount} 次
          </button>
          <button type="button" className="statbtn" onClick={() => setSheet("vocab")}>
            詞庫 {items.length}
          </button>
          {due > 0 && (
            <button type="button" className="statbtn statbtn--due" onClick={() => setSheet("review")}>
              複習 {due > 20 ? "20+" : due}
            </button>
          )}
        </div>
      )}

      {/* Crash recovery — a session that never reached「停止並儲存」 */}
      {draft && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--warn)" }}>
          <b>上次練習未儲存</b>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            {scenarios.find((s) => s.id === draft.scenarioId)?.title ?? "（情境已刪除）"} ·{" "}
            {draft.transcript.length} 句對話
          </p>
          <div className="row">
            <button className="btn btn--primary grow" onClick={recoverDraft} disabled={recovering}>
              {recovering ? "分析中…" : "分析並儲存"}
            </button>
            <button className="btn btn--ghost" onClick={discardDraft} disabled={recovering}>
              捨棄
            </button>
          </div>
        </div>
      )}

      {/* S2 — the story line: ONE button that says what happens next. Deliberately
          above 繼續上次 and without any episode list — the pull is「下一集」, and a
          dashboard of episodes would kill it. */}
      {primaryArc && (
        <ArcNextButton
          arc={primaryArc}
          busy={advancing === primaryArc.id}
          onPlay={() => playNextEpisode(primaryArc)}
        />
      )}
      {otherArcs.length > 0 &&
        (showOtherArcs ? (
          otherArcs.map((a) => (
            <ArcNextButton key={a.id} arc={a} busy={advancing === a.id} onPlay={() => playNextEpisode(a)} />
          ))
        ) : (
          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 8 }}
            onClick={() => setShowOtherArcs(true)}
          >
            其他故事線（{otherArcs.length}）
          </button>
        ))}

      {/* One-tap continue — the most recently practiced scenario in this language */}
      {props.lastPracticed && (
        <button
          className="btn btn--primary btn--block"
          style={{ marginTop: 16 }}
          onClick={() => props.onPractice(props.lastPracticed!)}
        >
          ▶ 繼續上次 · {props.lastPracticed.title}
        </button>
      )}

      {/* 1. 首次：金鑰 */}
      {!apiKey && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="label" htmlFor="key">
            連結你的 Gemini API 金鑰 — 只存在這台裝置
          </label>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            還沒有金鑰？到{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>{" "}
            登入 Google 帳號 → 點「Create API key」→ 複製貼回這裡（有免費額度）。建議順手在
            Google Cloud 設預算上限。
          </p>
          <div className="row">
            <input
              id="key"
              className="input grow"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="貼上金鑰"
            />
            <button className="btn btn--primary" onClick={saveKey} disabled={savingKey}>
              {savingKey ? "驗證中…" : "儲存"}
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
        {/* S2 — one control, not a second screen: the same brief either makes a
            one-off scenario or a multi-episode story line. */}
        <label className="row" style={{ marginBottom: 10, gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={serial} onChange={(e) => setSerial(e.target.checked)} />
          <span className="muted">連續劇 — 一條約 6 集、會接續下去的故事線</span>
        </label>
        <div className="row">
          <button className="btn btn--primary grow" onClick={build} disabled={building}>
            {building ? (serial ? "編寫中…" : "建立中…") : serial ? "建立連續劇" : "建立情境"}
          </button>
          <FileButton accept=".md,.txt,text/markdown,text/plain" label="匯入 .md" onFile={importBriefFile} />
        </div>
      </div>

      {/* 5. 設定與資料 — tucked behind ⚙️ (W5 minimalism) */}
      {showSettings && (
        <>
          <div className="section-title">設定與資料</div>
          <div className="card">
            <button className="btn btn--primary btn--block" onClick={backup} disabled={backingUp}>
              💾 {backingUp ? "備份中…" : "備份資料（存到檔案／NAS）"}
            </button>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn--ghost btn--sm" onClick={exportCsv}>
                匯出單字（CSV）
              </button>
              <FileButton accept=".json,application/json" label="匯入備份" onFile={importPackFile} small />
            </div>
            {persist !== "persisted" && (
              <p className="muted" style={{ margin: "10px 0 0" }}>
                {persist === "best-effort"
                  ? "⚠ 資料保存為「盡力而為」— 瀏覽器在空間不足時可能清除，請定期備份。"
                  : "⚠ 此瀏覽器無法鎖定本機資料，請定期備份。"}
              </p>
            )}
            {persist === "persisted" && (
              <p className="muted" style={{ margin: "10px 0 0" }}>✓ 資料已設為永久保存於本機。</p>
            )}
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
            {/* Escape hatch for a live-model rename (no server = no remote fix).
                Only needed if Google retires the default; empty = default. */}
            <label className="label" htmlFor={modelId} style={{ marginTop: 12 }}>
              語音模型（進階 — 留空用預設；官方改名導致連不上時才需要填）
            </label>
            <div className="row">
              <input
                id={modelId}
                className="input grow"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder={DEFAULT_LIVE_MODEL}
              />
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setLiveModelOverride(modelInput);
                  setModelInput(getLiveModelOverride());
                  setBusy(
                    getLiveModelOverride()
                      ? `✓ 語音模型改用 ${getLiveModelOverride()}。`
                      : `✓ 語音模型恢復預設（${DEFAULT_LIVE_MODEL}）。`,
                  );
                }}
              >
                套用
              </button>
            </div>
          </div>
        </>
      )}

      {busy && <p className="notice">{busy}</p>}

      {sheet === "history" && (
        <HistorySheet lang={lang} scenarios={scenarios} onClose={() => setSheet(null)} />
      )}
      {sheet === "vocab" && (
        <VocabSheet lang={lang} items={items} onChanged={props.onChanged} onClose={() => setSheet(null)} />
      )}
      {sheet === "review" && (
        <ReviewSheet lang={lang} items={items} onChanged={props.onChanged} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}

// --- building blocks ---

/**
 * S2 — a story line as ONE tap. Progress is shown as episode count, never a
 * percentage or a score (no-gamification red line), and the recap deliberately
 * lives in the coach's spoken opening rather than on this card.
 */
function ArcNextButton(props: { arc: Arc; busy: boolean; onPlay: () => void }) {
  const { arc } = props;
  const n = nextEpisodeNumber(arc);
  const played = playedCount(arc);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="scenario-title">📖 {arc.title}</div>
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        第 {n} 集 · 全劇約 {arc.plannedEpisodes} 集{played > 0 && `（已練 ${played} 集）`}
      </p>
      <button className="btn btn--primary btn--block" onClick={props.onPlay} disabled={props.busy}>
        {props.busy ? "準備下一集…" : `▶ 下一集 · 第 ${n} 集`}
      </button>
    </div>
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
