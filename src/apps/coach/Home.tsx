// 首頁（介面繁中；教學內容為英 / 日）。一眼一個主行動（U1）：
//   讀數條 → 主按鈕（homePrimary.ts：金鑰 → 下一集 → 再練一次 → 換個新劇情）
//   → 換個新劇情（主按鈕不是它時）→ 恢復卡（有草稿時）→「情境與新增」
//   你的情境、範例、新增情境都在 ScenariosSheet；設定與資料在 ⚙️。

import { useId, useState } from "react";

import {
  TARGET_LANGUAGES,
  type Arc,
  type DraftSession,
  type LearnedItem,
  type LearnerProfile,
  type Scenario,
  type SessionRecord,
  type TargetLanguage,
} from "../../kernel/types";
import { clearDraft, deleteScenario, putScenario, updateSession } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import {
  DEFAULT_LIVE_MODEL,
  DEFAULT_TEXT_MODEL,
  getLiveModelOverride,
  getTextModelOverride,
  setLiveModelOverride,
  setTextModelOverride,
} from "../../kernel/overrides";
import {
  backupPack,
  buildScenarioPack,
  commitImport,
  downloadFile,
  itemsToCsv,
  planImport,
  readTextFile,
} from "../../kernel/pack";
import { withPersona } from "../../kernel/persona";
import { persistedState, type PersistState } from "../../kernel/storage";
import { generateScenario, validateApiKey } from "./ai";
import { DEFAULT_ARCS } from "./arcDefaults";
import { ArcNextButton } from "./ArcNextButton";
import {
  advanceArc,
  pendingEpisode,
  installDemoArc,
  isArcFinished,
  nextEpisodeGenerator,
  seedGenerator,
  startArc,
  type DemoArc,
} from "./arcs";
import { DEFAULT_SCENARIOS } from "./defaults";
import { finalizeSession, PersistError, ResultsPersistError, type FinalizeOutcome } from "./finalize";
import { MAX_BRIEF_FILE_BYTES, briefProblem, briefPrompt, looksLikeText } from "./briefPrompt";
import { copyText } from "./clipboard";
import { FileButton } from "./formControls";
import { HistorySheet } from "./HistorySheet";
import { primaryAction } from "./homePrimary";
import { PersonaFields } from "./PersonaFields";
import { levelSummary } from "./progress";
import { computeReadouts } from "./readouts";
import { ReadoutStrip } from "./ReadoutStrip";
import { ReviewSheet } from "./ReviewSheet";
import { ScenariosSheet } from "./ScenariosSheet";
import { randomSeedBrief } from "./seeds";
import { Sheet } from "./Sheet";
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
  recentSessions: SessionRecord[]; // newest few dozen, for the readouts
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
  const [textModelInput, setTextModelInput] = useState(getTextModelOverride);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [building, setBuilding] = useState(false); // dedicated flag — not a magic busy string
  const [recovering, setRecovering] = useState(false); // guard double-tap on 恢復
  const [backingUp, setBackingUp] = useState(false); // guard double-tap on 備份
  const [editing, setEditing] = useState<Scenario | null>(null);
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
  // Settings is a sheet like the others: a panel appended to the bottom of a
  // long page looked like a dead button when tapped at the top.
  const [sheet, setSheet] = useState<"history" | "vocab" | "review" | "settings" | "scenarios" | null>(null);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null); // clipboard unavailable
  // A readout tapped on the progress strip opens History filtered to its sources.
  const [historyFocus, setHistoryFocus] = useState<string[] | null>(null);
  const modelId = useId();
  const textModelId = useId();

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
  const primary = primaryAction({ hasKey: !!apiKey, hasArc: !!primaryArc, hasLastPracticed: !!props.lastPracticed });
  // S4 — built-in demo arcs, minus any already installed (stable ids).
  const demoArcs = DEFAULT_ARCS[lang].filter((d) => !arcs.some((a) => a.id === d.id));
  const lvl = levelSummary(profile, lang); // W6
  const due = countDue(items, lang, new Date()); // W7
  const readouts = computeReadouts({ sessions: props.recentSessions, items, scenarios, language: lang });
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
    // The brief is checked first: it needs no key, and fixing it is the next step either way.
    const problem = briefProblem(brief);
    if (problem) return setBusy(problem);
    await buildFrom(brief, serial, { fromBriefBox: true });
  }

  // 換個新劇情 — zero typing: a built-in seed brief goes through the SAME
  // generator as a typed one, so the result is an ordinary scenario / arc.
  // Seeds already turned into a scenario here are skipped (Scenario.source).
  async function surprise(asSerial: boolean) {
    const seed = randomSeedBrief(
      lang,
      scenarios.filter((sc) => sc.targetLanguage === lang).map((sc) => sc.source),
    );
    await buildFrom(seed, asSerial, { fromBriefBox: false });
  }

  // One generation path for both the typed brief and a random seed. On
  // success a one-off scenario goes straight into practice (that is what the
  // tap meant); an arc lands as the page's「▶ 下一集 · 第 1 集」.
  async function buildFrom(submitted: string, asSerial: boolean, opts: { fromBriefBox: boolean }) {
    if (!apiKey) return setBusy("請先連結 API 金鑰。");
    if (building) return; // guard double-submit
    setBuilding(true);
    setBusy(asSerial ? "編寫連續劇中…（約 10–20 秒）" : "建立情境中…（約 10 秒）");
    try {
      if (asSerial) {
        // S1/S2 — an arc lands with episode 1 already materialised, so the very
        // next tap is「▶ 下一集 · 第 1 集」.
        const { arc } = await startArc(
          { brief: submitted.trim(), language: lang, level: profile.level },
          seedGenerator(apiKey),
        );
        if (opts.fromBriefBox) setBrief((b) => (b === submitted ? "" : b));
        props.onChanged();
        setBusy(`✓ 已建立連續劇「${arc.title}」，在「情境與新增」或首頁的故事線卡片按「▶」開始第 1 集。`);
        return;
      }
      const sc = await generateScenario(apiKey, {
        brief: submitted.trim(),
        language: lang,
        level: profile.level,
      });
      await putScenario(sc);
      // Clear only what was sent: text typed or imported while the model was
      // writing is the learner's next brief, not this one.
      if (opts.fromBriefBox) setBrief((b) => (b === submitted ? "" : b));
      props.onChanged();
      if (opts.fromBriefBox) {
        setBusy(`✓ 已建立「${sc.title}」，在「情境與新增」的「你的情境」可以開始練習。`);
      } else {
        setBusy("");
        props.onPractice(sc);
      }
    } catch (err) {
      setBusy(opts.fromBriefBox ? `錯誤：${describeError(err)}（簡報還在，不用重貼）` : `錯誤：${describeError(err)}（再點一次換一題）`);
    } finally {
      setBuilding(false);
    }
  }

  // S4 — installing a demo arc costs ZERO API calls: episode 1 is authored, so
  // this works with no key and offline, and goes straight into practice.
  async function startDemoArc(demo: DemoArc) {
    if (advancing) return;
    setAdvancing(demo.id);
    try {
      const { scenario } = await installDemoArc(demo);
      setBusy("");
      props.onPractice(scenario);
    } catch (err) {
      setBusy(`無法開始這條故事線：${describeError(err)}`);
    } finally {
      setAdvancing(null);
    }
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
      const outcome = await advanceArc(arc.id, nextEpisodeGenerator(apiKey));
      if (outcome.kind === "finished") {
        setBusy("這條故事線已經完結了。");
        props.onChanged();
        return;
      }
      // "broken" is NOT "finished": a record the story points at is gone, so say
      // that instead of congratulating them on an ending they never reached.
      if (outcome.kind === "broken") {
        setBusy(`${outcome.reason}這條故事線無法繼續 — 可從備份匯入，或建立一條新的。`);
        props.onChanged();
        return;
      }
      setBusy("");
      props.onPractice(outcome.scenario);
    } catch (err) {
      setBusy(`下一集還沒寫好：${describeError(err)}（再點一次即可重試）`);
    } finally {
      setAdvancing(null);
    }
  }

  // A brief the learner already typed is never silently replaced, and a file
  // that is not plain text is refused rather than pasted in as garbage.
  async function importBriefFile(file: File) {
    if (file.size > MAX_BRIEF_FILE_BYTES) {
      setBusy(`檔案太大（${Math.round(file.size / 1024)} KB）。練習簡報只需要重點，請先用「複製提示詞」請 ChatGPT／Gemini 整理成簡報。`);
      return;
    }
    try {
      const text = await readTextFile(file);
      if (!looksLikeText(text)) {
        setBusy("這個檔案不是純文字（可能是 PDF／PPT／Word）。請先用「複製提示詞」請 ChatGPT／Gemini 整理成簡報，再存成 .md 匯入或直接貼上。");
        return;
      }
      if (!text.trim()) return setBusy("這個檔案是空的。");
      if (brief.trim() && brief.trim() !== text.trim() && !window.confirm("「練習簡報」欄已有內容，要用這個檔案取代嗎？")) return;
      setBrief(text);
      setBusy(`已匯入 ${file.name}，確認內容後按「${serial ? "建立連續劇" : "建立情境"}」。`);
    } catch (err) {
      setBusy(`讀取檔案失敗：${describeError(err)}`);
    }
  }

  // Validate the WHOLE file first and say what would change; nothing is written
  // until the user confirms. A file that fails validation is refused entirely.
  async function importPackFile(file: File) {
    setBusy("檢查備份檔…");
    try {
      let json: unknown;
      try {
        json = JSON.parse(await readTextFile(file));
      } catch {
        throw new Error("這個檔案不是 JSON。");
      }
      const plan = await planImport(json);
      const { added, overwritten, replacesProfile } = plan.summary;
      const profileNote = replacesProfile ? "並取代學習者設定（等級／錯誤紀錄／偏好／稱呼與職務）。" : "";
      if (!window.confirm(`匯入將新增 ${added} 筆、覆蓋 ${overwritten} 筆現有資料${profileNote ? "，" + profileNote : "。"}要繼續嗎？`)) {
        setBusy("");
        return;
      }
      setBusy("匯入中…");
      await commitImport(plan);
      props.onChanged();
      setBusy(`已匯入：新增 ${added} 筆、覆蓋 ${overwritten} 筆。`);
    } catch (err) {
      setBusy(`匯入失敗，沒有任何資料被更動：${describeError(err)}`);
    }
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
  async function saveEdit() {
    if (!editing) return;
    const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
    await putScenario({ ...editing, objectives: clean(editing.objectives), targetPhrases: clean(editing.targetPhrases) });
    setEditing(null);
    props.onChanged();
  }

  function removeScenario(sc: Scenario) {
    return withBusy("", async () => {
      await deleteScenario(sc.id);
      props.onChanged();
    });
  }

  async function exportScenario(sc: Scenario) {
    const pack = await buildScenarioPack(sc);
    downloadFile(`${slug(sc.title)}.json`, JSON.stringify(pack, null, 2), "application/json");
  }

  // One tap → the prompt is on the clipboard. When no copy path works the
  // prompt opens in a sheet for a manual copy — never in the brief box, which
  // may already hold the learner's own text.
  async function copyPrompt() {
    const text = briefPrompt({ language: lang, level: profile.level, serial });
    if (await copyText(text)) {
      setBusy("✓ 已複製提示詞。貼到 ChatGPT／Gemini／Claude，附上你的簡報、報告或其他材料；把回覆貼回「練習簡報」，或存成 .md 用「匯入 .md」。");
    } else {
      setBusy("");
      setManualPrompt(text);
    }
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
          aids: draft.aids,
          aidedTurnIdx: draft.aidedTurnIdx,
          recycled: draft.recycled,
          // kind alone decides: a micro draft from the previous build has no
          // drilledFocus and must still never be judged as a full session.
          ...(draft.kind === "micro" ? { micro: { sourceSessionId: draft.drilledFocus?.sourceSessionId } } : {}),
        });
        setBusy(describeOutcome(out, "已救回上次練習"));
      } else {
        // Never overwrite a record a completed finalize already wrote (a draft
        // can outlive its session when clearDraft failed): keep what exists.
        let existed = false;
        await updateSession(draft.id, (existing) => {
          existed = !!existing;
          return (
            existing ?? {
              id: draft.id,
              scenarioId: draft.scenarioId,
              startedAt: draft.startedAt,
              transcript: draft.transcript,
              ...(draft.aids ? { aids: draft.aids } : {}),
              ...(draft.recycled ? { recycled: draft.recycled } : {}),
              ...(draft.kind ? { kind: draft.kind } : {}),
              ...(draft.drilledFocus ? { drilledFocus: draft.drilledFocus } : {}),
            }
          );
        });
        try {
          await clearDraft();
          setBusy(existed ? "這場先前已經儲存過了。" : `已儲存逐字稿（${sc ? "未設定金鑰" : "原情境已刪除"}，未分析）。`);
        } catch (e) {
          setBusy(`已儲存逐字稿，但草稿清不掉：${describeError(e)}`);
        }
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
            ? `${describeOutcome(err.outcome, "已救回並分析")}但部分結果未能寫入：${msg}`
            : `逐字稿已儲存（見「練習」紀錄），但分析失敗：${msg}`,
      );
    }
    setRecovering(false);
    props.onChanged();
  }

  async function discardDraft() {
    try {
      await clearDraft();
    } catch (e) {
      setBusy(`無法捨棄草稿：${describeError(e)}`);
    }
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
          aria-haspopup="dialog"
          onClick={() => {
            void persistedState().then(setRefreshedPersist); // refresh on open
            setBusy(""); // a notice from the page behind must not read as the sheet's
            setSheet("settings");
          }}
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

      {/* Progress readouts — three ratios with a trend mark, each tappable to the
          sessions it came from. Zero API; null when there is nothing to count. */}
      <ReadoutStrip
        readouts={readouts}
        onOpen={(ids) => {
          setHistoryFocus(ids);
          setSheet("history");
        }}
      />

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

      {/* U1 — ONE main action (homePrimary.ts). Everything else is behind
          「情境與新增」or ⚙️; the readouts above stay a glance, not a menu. */}
      {primary === "key" && (
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
      {primary === "arc" && primaryArc && (
        <ArcNextButton
          arc={primaryArc}
          busy={advancing === primaryArc.id}
          onPlay={() => playNextEpisode(primaryArc)}
        />
      )}
      {/* 「再練一次」, not「繼續上次」: the coach runs a fresh variation of the
          same scenario (prompt.ts priorPlays), it does not resume a conversation
          it cannot see. */}
      {primary === "replay" && props.lastPracticed && (
        <button
          className="btn btn--primary btn--block"
          style={{ marginTop: 16 }}
          onClick={() => props.onPractice(props.lastPracticed!)}
        >
          ▶ 再練一次 · {props.lastPracticed.title}
        </button>
      )}
      {/* 換個新劇情 — a new story is one tap, as cheap as continuing the old one.
          The main action when there is nothing to continue; otherwise the one
          secondary choice. The story-line variant lives in the sheet. */}
      {primary !== "key" && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="scenario-title">🎲 換個新劇情</div>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            不用想題目：隨機抽一個{LANG_LABEL[lang]}情境，教練會帶著你聊。
          </p>
          <button
            className={`btn btn--block ${primary === "new" ? "btn--primary" : "btn--ghost"}`}
            onClick={() => void surprise(false)}
            disabled={building}
          >
            {building ? "準備中…" : "🎲 換個新劇情"}
          </button>
        </div>
      )}

      <button
        className="btn btn--ghost btn--block"
        style={{ marginTop: 16 }}
        aria-haspopup="dialog"
        onClick={() => {
          setBusy(""); // a notice from the page behind must not read as the sheet's
          setSheet("scenarios");
        }}
      >
        情境與新增（{mine.length + samples.length + demoArcs.length + otherArcs.length}）
      </button>

      {/* Always mounted so screen readers announce each new message. */}
      <div className="toast-slot" role="status" aria-live="polite">
        {busy && (
          <div className="toast">
            <p className={busy.startsWith("✓") ? "notice notice--ok" : "notice"}>{busy}</p>
            <button className="toast-close" onClick={() => setBusy("")} aria-label="關閉訊息">
              ✕
            </button>
          </div>
        )}
      </div>

      {manualPrompt !== null && (
        <Sheet title="複製提示詞" onClose={() => setManualPrompt(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            這個瀏覽器不讓我直接複製。請長按或全選下面的文字複製，貼到 ChatGPT／Gemini／Claude 並附上你的材料。
          </p>
          <textarea
            className="textarea"
            readOnly
            value={manualPrompt}
            rows={12}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="提示詞"
          />
        </Sheet>
      )}

      {/* 5. 設定與資料 — behind ⚙️, as a sheet like the other secondary screens */}
      {sheet === "settings" && (
        <Sheet title="設定與資料" onClose={() => setSheet(null)}>
          <div>
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
            <PersonaFields persona={profile.persona} onSave={(p) => props.onProfile(withPersona(profile, p))} />
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
            <label className="label" htmlFor={textModelId} style={{ marginTop: 12 }}>
              文字模型（進階 — 評量與情境生成；留空用預設）
            </label>
            <div className="row">
              <input
                id={textModelId}
                className="input grow"
                value={textModelInput}
                onChange={(e) => setTextModelInput(e.target.value)}
                placeholder={DEFAULT_TEXT_MODEL}
              />
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setTextModelOverride(textModelInput);
                  setTextModelInput(getTextModelOverride());
                  setBusy(
                    getTextModelOverride()
                      ? `✓ 文字模型改用 ${getTextModelOverride()}。`
                      : `✓ 文字模型恢復預設（${DEFAULT_TEXT_MODEL}）。`,
                  );
                }}
              >
                套用
              </button>
            </div>
            {busy && <p className="notice">{busy}</p>}
          </div>
        </Sheet>
      )}

      {sheet === "history" && (
        <HistorySheet
          apiKey={apiKey}
          lang={lang}
          scenarios={scenarios}
          profile={profile}
          onlyIds={historyFocus}
          onChanged={props.onChanged}
          onClose={() => {
            setSheet(null);
            setHistoryFocus(null);
          }}
        />
      )}
      {sheet === "scenarios" && (
        <ScenariosSheet
          lang={lang}
          langLabel={LANG_LABEL[lang]}
          onClose={() => setSheet(null)}
          busy={busy}
          otherArcs={otherArcs}
          advancing={advancing}
          onPlayArc={(a) => void playNextEpisode(a)}
          mine={mine}
          editing={editing}
          onEditChange={setEditing}
          onSaveEdit={() => void saveEdit()}
          onPractice={props.onPractice}
          onExport={(sc) => void exportScenario(sc)}
          onDelete={(sc) => void removeScenario(sc)}
          samples={samples}
          demoArcs={demoArcs}
          showSamples={showSamples}
          onShowSamples={() => setShowSamples(true)}
          onStartDemo={(d) => void startDemoArc(d)}
          level={profile.level}
          onLevel={(level) => props.onProfile({ ...profile, level })}
          brief={brief}
          onBrief={setBrief}
          serial={serial}
          onSerial={setSerial}
          building={building}
          onBuild={() => void build()}
          onCopyPrompt={() => void copyPrompt()}
          onImportBrief={(f) => void importBriefFile(f)}
          onSurpriseSerial={() => void surprise(true)}
        />
      )}
      {sheet === "vocab" && (
        <VocabSheet lang={lang} items={items} onChanged={props.onChanged} onClose={() => setSheet(null)} />
      )}
      {sheet === "review" && (
        <ReviewSheet
          apiKey={apiKey}
          lang={lang}
          items={items}
          onChanged={props.onChanged}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

// --- building blocks ---

/** One sentence for a finalize outcome — numbers only when a review exists. */
function describeOutcome(out: FinalizeOutcome, lead: string): string {
  switch (out.kind) {
    case "micro":
      return `${lead}：已儲存加練逐字稿。`;
    case "not-saved":
      return `沒有儲存：${out.reason}`;
    case "already":
      return "這場先前已經分析並儲存過了。";
    case "in-progress":
      return `這場正由另一個分頁分析中，或上次分析在 ${new Date(out.claimedAt).toLocaleTimeString("zh-TW")} 中斷；十分鐘後可在練習紀錄重試評量。`;
    case "done":
      return out.judge.kind === "review"
        ? `${lead}：CEFR ${out.judge.review.cefr}，${itemsText(out)}。`
        : `${lead}：逐字稿已存、${itemsText(out)}；評量未完成（${describeError(out.judge.reason)}），可在練習紀錄重試。`;
    default:
      return assertNever(out);
  }
}

const itemsText = (out: { items: number; itemsFailed: boolean }) =>
  out.itemsFailed ? "抽詞失敗（重試評量時補）" : `新增 ${out.items} 個詞彙`;

function assertNever(x: never): never {
  throw new Error(`unhandled outcome: ${JSON.stringify(x)}`);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scenario";
}
