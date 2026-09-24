// Live spoken practice for one scenario: the UI over a PracticeSession (which
// owns the transport, the audio engine and the turn cue). On stop it finalises:
// save the session, extract LearnedItems into the shared kernel, and refresh
// the scenario's rolling progress note.
//
// In-car UX: one big circular mic button is the whole control surface — start
// is a large green target, stop is a large red one, status is glanceable.

import { useCallback, useEffect, useRef, useState } from "react";

import { getArc, listItems, putDraft, putProfile } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import { liveModel } from "../../kernel/overrides";
import { ERROR_TYPE_LABEL } from "../../kernel/types";
import type { LearnerProfile, Scenario, SessionReview, TranscriptTurn } from "../../kernel/types";
import { suggestReplies, translateLine, type ReplySuggestion } from "./ai";
import { CanDoSelfCheck } from "./CanDoSelfCheck";
import { LevelMeter, type LevelSubscribe } from "./LevelMeter";
import { finalizeSession, PersistError, ResultsPersistError, type FinalizeOutcome } from "./finalize";
import { normaliseStoryState } from "./arcs";
import { weakObjectives } from "./objectives";
import { band } from "./progress";
import { composeSystemInstruction, type ArcContext } from "./prompt";
import {
  defaultSessionDeps,
  PracticeSession,
  type CoachClip,
  type SessionListener,
  type SessionPhase,
  type Turn,
} from "./session";
import { Shadowing } from "./Shadowing";
import { dueQueue } from "./srs";
import { pickVoice } from "./voices";

const RECYCLE_CAP = 5; // W7 — due items woven into a session: recycle, not drill

// Screen states. The session's own phases map onto the first four; "dropped"
// is a lost connection with the transcript still on screen, so the learner can
// save what was said or start over; saving/done are the finalize pipeline.
type Status = "ready" | "connecting" | "awaiting-mic" | "live" | "dropped" | "saving" | "done";

const STATUS_LABEL: Record<Status, string> = {
  ready: "準備好",
  connecting: "連線中…",
  "awaiting-mic": "等待麥克風…",
  live: "練習中",
  dropped: "連線中斷",
  saving: "分析中…",
  done: "完成",
};

/** S2 — the story context for an arc episode, or undefined for a standalone
 *  scenario (and for an episode whose arc record has gone missing). */
async function loadArcContext(scenario: Scenario): Promise<ArcContext | undefined> {
  if (!scenario.arc) return undefined;
  const arc = await getArc(scenario.arc.arcId);
  if (!arc) return undefined;
  const n = scenario.arc.episode;
  return {
    title: arc.title,
    episode: n,
    planned: arc.plannedEpisodes,
    recap: arc.episodes.find((e) => e.n === n)?.recap,
    // An arc can arrive from a hand-editable LearningPack, so its storyState is
    // untrusted here too — prompt assembly indexes into these arrays.
    storyState: normaliseStoryState(arc.storyState),
    isFinal: n >= arc.plannedEpisodes,
  };
}

export function Practice(props: {
  apiKey: string;
  scenario: Scenario;
  profile: LearnerProfile;
  onExit: () => void;
}) {
  const { apiKey, scenario, profile } = props;
  const [status, setStatus] = useState<Status>("ready");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<FinalizeOutcome | null>(null);
  const [turn, setTurn] = useState<Turn>("coach"); // whose turn (voice UX), drain-gated
  const [paused, setPaused] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [suggestions, setSuggestions] = useState<ReplySuggestion[] | null>(null);
  const [helping, setHelping] = useState(false);
  const [slow, setSlow] = useState(!!profile.prefs?.slowSpeech);
  const [coachClip, setCoachClip] = useState<CoachClip | null>(null); // D1 — 跟讀 model
  const [showLevel, setShowLevel] = useState(!!profile.prefs?.showLevelMeter); // E2 — opt-in
  // tapped-line translations, keyed by index but tagged with the source text so a
  // still-growing streamed line doesn't show a stale partial translation.
  const [tx, setTx] = useState<Record<number, { src: string; zh: string }>>({});

  const sessionRef = useRef<PracticeSession | null>(null);
  const startedAtRef = useRef<string>("");
  const sessionIdRef = useRef<string>("");
  const finalizingRef = useRef(false);
  const startingRef = useRef(false); // guards the async start() window against re-entry
  const cancelledRef = useRef(false); // 取消 tapped while start() was still reading IndexedDB
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const draftTimerRef = useRef<number | null>(null);
  const draftFailsRef = useRef(0); // consecutive backup failures
  const [draftWarning, setDraftWarning] = useState(false);

  // The session owner is created once per screen. Its listener touches only
  // setState and refs, so it never goes stale across renders.
  function session(): PracticeSession {
    if (!sessionRef.current) sessionRef.current = new PracticeSession(defaultSessionDeps, listener);
    return sessionRef.current;
  }

  const listener: SessionListener = {
    onPhase: (p: SessionPhase) => {
      switch (p.kind) {
        case "idle":
        case "stopping":
          return;
        case "connecting":
          setStatus("connecting");
          return;
        case "awaiting-mic":
          setStatus("awaiting-mic");
          return;
        case "live":
          setStatus("live");
          setPaused(p.paused);
          setReconnecting(p.reconnecting);
          return;
        case "ended":
          if (finalizingRef.current) return; // stopAndFinalize / unmount drive their own status
          setPaused(false); // live-only flags must not colour the pill after the session ended
          setReconnecting(false);
          switch (p.by) {
            case "user":
              setStatus("ready"); // cancelled while connecting
              return;
            case "start-failed":
              setStatus("ready");
              setNotice(`無法開始：${describeError(p.reason)}`);
              return;
            case "connection":
              setStatus("dropped");
              // A close reason like "quota exceeded" tells the user whether
              // retrying can even work — surface it translated when we have one.
              setNotice(
                p.reason && p.reason !== "closed"
                  ? `連線中斷：${describeError(p.reason)}`
                  : turnsRef.current.length > 0
                    ? "連線中斷。逐字稿還在，可以儲存這段或重新開始。"
                    : "連線中斷，可以重新開始。",
              );
              return;
            default:
              return assertNever(p);
          }
        default:
          return assertNever(p);
      }
    },
    onCue: setTurn,
    onTranscript: (who, text) => pushDelta(who, text),
    onCoachClip: setCoachClip,
    onNotice: setNotice,
  };

  // Authoritative safety net: release mic + WebSocket if the screen unmounts
  // for any reason (not just the guarded Back button). finalizingRef is set so
  // the resulting phase events don't setState on an unmounted component.
  useEffect(() => {
    return () => {
      finalizingRef.current = true;
      void sessionRef.current?.stop();
    };
  }, []);

  // The OS silently releases the wake lock whenever the page is hidden —
  // the session re-acquires it on return while still running.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") sessionRef.current?.pageVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Crash-safety: persist the in-progress transcript (throttled) so a reaped
  // mobile tab never loses the conversation. Home offers recovery on next open.
  // Gated on finalizingRef: a transcript event buffered during teardown must
  // not re-arm the timer after finalize cleared the draft (phantom recovery).
  function scheduleDraftSave() {
    if (finalizingRef.current || draftTimerRef.current != null) return;
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      if (finalizingRef.current) return;
      putDraft(currentDraft())
        .then(() => {
          draftFailsRef.current = 0;
          setDraftWarning(false);
        })
        .catch(() => {
          // Never disturb the live session, but repeated failures mean the
          // advertised crash protection doesn't exist — say so, quietly.
          draftFailsRef.current += 1;
          if (draftFailsRef.current >= 3) setDraftWarning(true);
        });
    }, 1200);
  }

  function currentDraft() {
    return {
      id: sessionIdRef.current,
      scenarioId: scenario.id,
      startedAt: startedAtRef.current,
      transcript: turnsRef.current,
    };
  }

  // Keep the latest line in view during a live session, but don't fight the user
  // if they've scrolled up to re-read.
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
    if (nearBottom) el.scrollIntoView({ behavior: "auto", block: "end" });
  }, [transcript]);

  function pushDelta(who: TranscriptTurn["who"], text: string) {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      const next =
        last && last.who === who
          ? [...prev.slice(0, -1), { who, text: last.text + text }]
          : [...prev, { who, text }];
      turnsRef.current = next;
      return next;
    });
    scheduleDraftSave();
  }

  async function start() {
    if (!apiKey) {
      setNotice("尚未設定金鑰 — 請先在首頁設定。");
      return;
    }
    const current = session().currentPhase().kind;
    if (startingRef.current || (current !== "idle" && current !== "ended")) return; // double tap / re-entry
    startingRef.current = true;
    cancelledRef.current = false;
    setStatus("connecting");
    setNotice("");
    setTranscript([]);
    turnsRef.current = [];
    finalizingRef.current = false;
    setPaused(false);
    setReconnecting(false);
    setSuggestions(null);
    setCoachClip(null); // D1 — a new session starts with no shadowing model
    setTx({});
    startedAtRef.current = new Date().toISOString();
    sessionIdRef.current = crypto.randomUUID();

    try {
      // W7 — read due items NOW (not at render): the app can sit open for hours
      // and reviews/deletes may happen meanwhile. C1 — also load the objectives
      // the mastery ledger flags as still-developing, so the coach prioritises
      // them. Both best-effort: a read failure just means no recycle / no flag.
      // S2 — if this scenario is an arc episode, load the story continuity too.
      const [dueItems, weak, arcContext] = await Promise.all([
        listItems()
          .then((its) => dueQueue(its, scenario.targetLanguage, new Date(), RECYCLE_CAP))
          .catch(() => []),
        // C1 + S3 — weak spots from THIS episode's scenario row and, for an arc,
        // from the arc-level can-do ledger that accumulates across episodes.
        Promise.all([
          weakObjectives(scenario.id).catch(() => []),
          scenario.arc ? weakObjectives(scenario.arc.arcId).catch(() => []) : Promise.resolve([]),
        ]).then(([own, arcWide]) => [...new Set([...own, ...arcWide])]),
        // NOT best-effort in the same sense as the two above: without this an arc
        // episode runs with no recap and no story state — the coach simply forgets
        // the plot — and the session still counts. So say so rather than swallow it.
        loadArcContext(scenario).catch((e) => {
          if (scenario.arc)
            setNotice(`讀不到前情提要，教練可能不記得之前的劇情：${describeError(e)}`);
          return undefined;
        }),
      ]);
      if (finalizingRef.current) return; // Back was tapped while the reads ran
      if (cancelledRef.current) {
        setStatus("ready"); // 取消 was tapped before the session even existed
        return;
      }
      // composeSystemInstruction/pickVoice run inside the try, so a synchronous
      // throw (e.g. a malformed imported scenario) is caught and the finally
      // still resets startingRef — otherwise Start would wedge.
      const spec = {
        apiKey,
        model: liveModel(), // ⚙️ override wins — repairable from the phone if renamed
        systemInstruction: composeSystemInstruction(scenario, profile, dueItems, weak, arcContext),
        voiceName: pickVoice(scenario.targetLanguage),
      };
      // Outcome arrives through the phase stream (live / start-failed / cancelled).
      await session().start(spec);
    } catch (err) {
      setStatus("ready");
      setNotice(`無法開始：${describeError(err)}`);
    } finally {
      startingRef.current = false;
    }
  }

  /** Back out while connecting / waiting for the mic. */
  function cancelStart() {
    cancelledRef.current = true; // covers the pre-connect reads, where stop() has nothing to stop
    void session().stop();
  }

  function pauseSession() {
    session().pause(); // mic off + silence coach; live socket stays open
    // keep any 卡住 suggestions visible so the learner can rehearse them while paused
  }

  async function resumeSession() {
    setNotice("");
    await session().resume(); // reconnects through the resumption handle if needed
  }

  async function helpMe() {
    if (helping || !apiKey) return;
    setHelping(true);
    try {
      setSuggestions(await suggestReplies(apiKey, { scenario, transcript: turnsRef.current }));
    } catch {
      setNotice("提示載入失敗，請再試一次。");
    }
    setHelping(false);
  }

  // Both toggles write the WHOLE prefs object from local state, because the
  // `profile` prop stays stale for the rest of the session (Practice has no reload)
  // and stopAndFinalize writes prefs back from it — a partial write here would be
  // silently reverted when the session ends.
  function savePrefs(next: { slowSpeech: boolean; showLevelMeter: boolean }) {
    putProfile({ ...profile, prefs: { ...profile.prefs, ...next } }).catch((e) =>
      setNotice(`偏好設定沒能存起來：${describeError(e)}`),
    );
  }

  function toggleSpeed() {
    const next = !slow;
    setSlow(next);
    session().setPlaybackRate(next ? 0.85 : 1);
    savePrefs({ slowSpeech: next, showLevelMeter: showLevel });
  }

  // E2 — remember the choice, so someone who wants the meter isn't re-enabling it
  // every session and someone who doesn't never sees it again.
  function toggleLevelMeter() {
    const next = !showLevel;
    setShowLevel(next);
    session().setLevelReporting(next);
    savePrefs({ slowSpeech: slow, showLevelMeter: next });
  }

  // Stable across renders — the meter uses it as an effect dependency, so a new
  // identity each render would re-subscribe on every level tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session() reads a ref
  const subscribeLevel = useCallback<LevelSubscribe>((l) => session().subscribeLevel(l), []);

  async function translateAt(i: number, text: string) {
    if (tx[i]?.src === text) {
      setTx((m) => {
        const c = { ...m };
        delete c[i];
        return c;
      });
      return;
    }
    if (!apiKey) return;
    try {
      const zh = await translateLine(apiKey, text);
      setTx((m) => ({ ...m, [i]: { src: text, zh } }));
    } catch {
      /* ignore translate failures */
    }
  }

  async function stopAndFinalize() {
    if (finalizingRef.current) return; // ignore double taps
    finalizingRef.current = true;
    if (draftTimerRef.current != null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    // Flush (not just cancel) the pending backup: if the save below fails, the
    // surviving draft must hold the FULL conversation, not one 1.2s short.
    await putDraft(currentDraft()).catch(() => {});
    await session().stop(); // devices first, then the snapshot; no-op after a drop
    setStatus("saving");

    try {
      // Shared pipeline: transcript first, then judge + items + profile fold.
      // Merge the current slow-speech pref so it isn't clobbered.
      const outcome = await finalizeSession(apiKey, {
        scenario,
        // Carry BOTH live prefs, or finalize's profile write reverts whichever one
        // was toggled during the session.
        profile: { ...profile, prefs: { ...profile.prefs, slowSpeech: slow, showLevelMeter: showLevel } },
        sessionId: sessionIdRef.current,
        startedAt: startedAtRef.current,
        transcript: turnsRef.current,
      });
      setSummary(outcome);
    } catch (err) {
      const msg = describeError(err);
      // Three honest cases: PersistError = NOTHING saved (draft survives for
      // Home's recovery card); ResultsPersistError = transcript saved AND
      // analysis done, but the results only partially stored (still show the
      // recap we computed); anything else = saved, analysis failed.
      if (err instanceof ResultsPersistError) {
        setNotice(`分析完成，但部分結果未能寫入（等級／詞庫／下次重點可能沒更新）：${msg}`);
        setSummary(err.outcome);
      } else {
        setNotice(
          err instanceof PersistError
            ? `儲存失敗 — 逐字稿暫存為草稿，回首頁可再「分析並儲存」：${msg}`
            : `已儲存，但分析失敗：${msg}`,
        );
        setSummary({ kind: "done", items: 0, judge: { kind: "unavailable", reason: msg } });
      }
    }
    setStatus("done");
  }

  // Back is guarded only where leaving would lose something: live (use Stop)
  // and saving. While connecting, Back simply cancels — the unmount stops the
  // session and no transcript exists yet.
  const backLocked = status === "live" || status === "saving";
  const starting = status === "connecting" || status === "awaiting-mic";
  const pillTone = paused || reconnecting ? "pill--warn" : status === "live" ? "pill--live" : "pill--neutral";
  const pillText = paused ? "已暫停" : reconnecting ? "重新連線中…" : STATUS_LABEL[status];

  return (
    <main className="app">
      <div className="topbar">
        <button className="btn btn--ghost btn--sm" onClick={props.onExit} disabled={backLocked}>
          ← 返回
        </button>
        <span className="grow" />
        <span className={`pill ${pillTone}`}>{pillText}</span>
      </div>

      <h1 style={{ marginTop: 16 }}>{scenario.title}</h1>
      <div className="row" style={{ margin: "8px 0" }}>
        <span className="pill pill--neutral">{scenario.targetLanguage.toUpperCase()}</span>
        <span className="pill pill--neutral">CEFR {scenario.level}</span>
      </div>
      <p className="muted">{scenario.contentContext}</p>
      {notice && <p className="notice">{notice}</p>}
      {draftWarning && status === "live" && (
        <p className="notice">⚠ 自動備份持續失敗 — 若這個分頁被中斷，可能遺失這段逐字稿。</p>
      )}

      {/* Hero control */}
      {status !== "done" && (
        <div className="practice-hero">
          {status === "saving" ? (
            <p className="muted">正在分析本次練習…</p>
          ) : status === "live" ? (
            // Pure status indicator (whose turn / paused). NOT a button — controls
            // live in the pinned bottom bar so a tap here can't end the session.
            <>
              <div className="mic-btn mic-btn--live mic-btn--status" role="status" aria-live="polite">
                <span className="mic-emoji">{paused ? "⏸" : turn === "coach" ? "🔊" : "🎤"}</span>
                {paused ? "已暫停" : turn === "coach" ? "教練說話中" : "換你說"}
              </div>
              {!paused && (
                <div className="row" style={{ justifyContent: "center", marginTop: 4 }}>
                  <button className="btn btn--ghost btn--sm" onClick={helpMe} disabled={helping}>
                    💡 {helping ? "想一下…" : "卡住?"}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={toggleSpeed} aria-pressed={slow}>
                    🐢 {slow ? "慢速 ✓" : "慢速"}
                  </button>
                  {/* E2 — off by default; the orb stays the only thing on screen
                      unless the learner asks to see whether the mic hears them. */}
                  <button className="btn btn--ghost btn--sm" onClick={toggleLevelMeter} aria-pressed={showLevel}>
                    📊 {showLevel ? "音量 ✓" : "音量"}
                  </button>
                </div>
              )}
              {showLevel && !paused && <LevelMeter subscribe={subscribeLevel} />}
              {/* D1 — 跟讀 lives in the paused state on purpose: live, the mic is
                  streaming to Gemini and a practice attempt would be answered. */}
              {paused && <Shadowing clip={coachClip} />}
              {suggestions && suggestions.length > 0 && (
                <div className="card" style={{ width: "100%", marginTop: 8 }}>
                  <div className="muted" style={{ marginBottom: 6 }}>可以這樣說：</div>
                  {suggestions.map((s, i) => (
                    <div key={i} style={{ marginBottom: i < suggestions.length - 1 ? 8 : 0 }}>
                      <div style={{ color: "var(--coach)" }}>{s.say}</div>
                      <div className="muted">{s.gloss}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : status === "dropped" ? (
            // The connection is gone but the words are not: offer to keep them.
            <div className="row" style={{ justifyContent: "center" }}>
              {transcript.length > 0 && (
                <button className="btn btn--primary" onClick={stopAndFinalize}>
                  ■ 儲存這段
                </button>
              )}
              <button className="btn btn--ghost" onClick={start}>
                🎙️ 重新開始
              </button>
            </div>
          ) : (
            <>
              <button className="mic-btn" onClick={start} disabled={starting}>
                <span className="mic-emoji">🎙️</span>
                {starting ? STATUS_LABEL[status] : "開始"}
              </button>
              {status === "awaiting-mic" && <p className="muted">會請求麥克風權限，請允許</p>}
              {starting && (
                <button className="btn btn--ghost btn--sm" onClick={cancelStart}>
                  取消
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Done summary — says exactly what was stored. A review that could not be
          produced is shown as that, never as numbers. */}
      {status === "done" && summary && (
        <div className="card" style={{ marginTop: 16 }}>
          <Recap outcome={summary} scenarioId={scenario.id} />
          <button className="btn btn--primary btn--block" style={{ marginTop: 12 }} onClick={props.onExit}>
            完成
          </button>
        </div>
      )}

      <div className="section-title">逐字稿{transcript.length > 0 && <span className="muted"> · 點句翻中文</span>}</div>
      <div className="card transcript">
        {transcript.length === 0 && <span className="muted">對話會顯示在這裡…</span>}
        {transcript.map((t, i) => (
          <div key={i}>
            <div className={`turn ${t.who === "user" ? "turn--you" : "turn--coach"}`}>
              <span className="turn-who">{t.who === "user" ? "你" : "教練"}</span>
              <button
                type="button"
                className="turn-text turn-text--tap"
                aria-label="點擊翻成中文"
                onClick={() => translateAt(i, t.text)}
              >
                {t.text}
              </button>
            </div>
            {tx[i]?.src === t.text && (
              <div className="muted" style={{ paddingLeft: 48 }}>
                ↳ {tx[i].zh}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} aria-hidden />
      </div>

      {/* Always-reachable controls while live — no scrolling back up. */}
      {status === "live" && (
        <>
          <div style={{ height: 132 }} aria-hidden />
          <div className="stopbar">
            <div className="stopbar-row">
              <button className="btn btn--ghost" onClick={paused ? resumeSession : pauseSession}>
                {paused ? "▶ 接續" : "⏸ 暫停"}
              </button>
              <button className="btn btn--danger grow" onClick={stopAndFinalize}>
                ■ 停止並儲存
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Recap(props: { outcome: FinalizeOutcome; scenarioId: string }) {
  const { outcome } = props;
  switch (outcome.kind) {
    case "micro":
      return <b>已儲存這段加練</b>;
    case "already":
      return (
        <>
          <b>這場已經分析並儲存過了</b>
          {outcome.review && <ReviewBody review={outcome.review} scenarioId={props.scenarioId} />}
        </>
      );
    case "done":
      return (
        <>
          {outcome.judge.kind === "review" ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>已儲存本次練習</b>
                <span className="pill pill--neutral">CEFR {outcome.judge.review.cefr}</span>
              </div>
              <ReviewBody review={outcome.judge.review} scenarioId={props.scenarioId} />
            </>
          ) : (
            <>
              <b>已儲存逐字稿</b>
              <p className="muted" style={{ marginTop: 8 }}>
                評量未完成：{outcome.judge.reason}。等級與下次重點沒有更新；可在首頁「練習紀錄」重試評量。
              </p>
            </>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            已新增 {outcome.items} 個單字／語句到你的詞庫。
          </p>
        </>
      );
    default:
      return assertNever(outcome);
  }
}

function ReviewBody(props: { review: SessionReview; scenarioId: string }) {
  const { review } = props;
  return (
    <>
      {review.subscores && (
        <p className="muted" style={{ marginTop: 8 }}>
          文法 {band(review.subscores.grammar)}・詞彙 {band(review.subscores.vocab)}・流暢{" "}
          {band(review.subscores.fluency)}・互動 {band(review.subscores.interaction)}
        </p>
      )}
      {review.reviewZh && <p className="muted">{review.reviewZh}</p>}
      {review.reviewEn && <p className="muted">{review.reviewEn}</p>}
      {review.objectivesMet && review.objectivesMet.length > 0 && (
        <CanDoSelfCheck scenarioId={props.scenarioId} objectives={review.objectivesMet} />
      )}
      {review.wins?.map((w, i) => (
        <div key={`w${i}`} className="muted">
          👍 {w}
        </div>
      ))}
      {review.fixes?.map((f, i) => (
        <div key={`f${i}`} className="muted">
          🔧 {f}
        </div>
      ))}
      {/* E1 — one line naming the error TYPES confirmed this session. One line,
          not a dashboard: the value is that these accumulate and steer the coach. */}
      {review.errors && review.errors.length > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          📌 這次的錯誤型態：{review.errors.map((e) => ERROR_TYPE_LABEL[e.type]).join("・")}
        </p>
      )}
      {review.progressNote && <p className="muted">↪ 下次重點：{review.progressNote}</p>}
    </>
  );
}

function assertNever(x: never): never {
  throw new Error(`unhandled phase: ${JSON.stringify(x)}`);
}
