// Live spoken practice for one scenario. Reuses the proven audio + direct-Gemini
// transport; on stop it finalises: save the session, extract LearnedItems into
// the shared kernel, and refresh the scenario's rolling progress note.
//
// In-car UX: one big circular mic button is the whole control surface — start
// is a large green target, stop is a large red one, status is glanceable.

import { useCallback, useEffect, useRef, useState } from "react";

import { AudioEngine, type CoachClip } from "../../audio/AudioEngine";
import { GeminiLiveDirect } from "../../api/gemini-direct";
import { getArc, listItems, putDraft, putProfile } from "../../kernel/db";
import { describeError } from "../../kernel/errors";
import { liveModel } from "../../kernel/overrides";
import { ERROR_TYPE_LABEL } from "../../kernel/types";
import type { LearnerProfile, Scenario, TranscriptTurn } from "../../kernel/types";
import { suggestReplies, translateLine, type ReplySuggestion, type SessionReview } from "./ai";
import { CanDoSelfCheck } from "./CanDoSelfCheck";
import { LevelMeter, type LevelSubscribe } from "./LevelMeter";
import { emptyReview, finalizeSession, PersistError, ResultsPersistError } from "./finalize";
import { normaliseStoryState } from "./arcs";
import { weakObjectives } from "./objectives";
import { band } from "./progress";
import { composeSystemInstruction, type ArcContext } from "./prompt";
import { Shadowing } from "./Shadowing";
import { dueQueue } from "./srs";
import { pickVoice } from "./voices";

const RECYCLE_CAP = 5; // W7 — due items woven into a session: recycle, not drill

type Status = "ready" | "connecting" | "live" | "saving" | "done";

const STATUS_LABEL: Record<Status, string> = {
  ready: "準備好",
  connecting: "連線中…",
  live: "練習中",
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
  const [summary, setSummary] = useState<{ items: number; review: SessionReview } | null>(null);
  const [phase, setPhase] = useState<"coach" | "you">("coach"); // whose turn (voice UX)
  const [paused, setPaused] = useState(false);
  const [suggestions, setSuggestions] = useState<ReplySuggestion[] | null>(null);
  const [helping, setHelping] = useState(false);
  const [slow, setSlow] = useState(!!profile.prefs?.slowSpeech);
  const [coachClip, setCoachClip] = useState<CoachClip | null>(null); // D1 — 跟讀 model
  const [showLevel, setShowLevel] = useState(!!profile.prefs?.showLevelMeter); // E2 — opt-in
  // tapped-line translations, keyed by index but tagged with the source text so a
  // still-growing streamed line doesn't show a stale partial translation.
  const [tx, setTx] = useState<Record<number, { src: string; zh: string }>>({});

  const engineRef = useRef<AudioEngine | null>(null);
  const pausedRef = useRef(false);
  const resumingRef = useRef(false); // guards double-tap on ▶ 接續
  const clientRef = useRef<GeminiLiveDirect | null>(null);
  const startedAtRef = useRef<string>("");
  const sessionIdRef = useRef<string>("");
  const finalizingRef = useRef(false);
  const startingRef = useRef(false); // guards the async start() window against re-entry
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  // E2 — the meter subscribes itself so 10 Hz level updates re-render only the
  // meter, never this screen's transcript. No listener = the engine skips the maths.
  const levelListenerRef = useRef<((rms: number) => void) | null>(null);
  const draftFailsRef = useRef(0); // consecutive backup failures
  const [draftWarning, setDraftWarning] = useState(false);

  // Authoritative safety net: tear down mic + WebSocket if the screen unmounts
  // for any reason (not just the guarded Back button). finalizingRef is set so
  // the resulting onClose doesn't try to setState on an unmounted component.
  useEffect(() => {
    return () => {
      finalizingRef.current = true;
      void teardown();
    };
  }, []);

  // Keep the screen awake during a session — hands-off phone/car practice dies
  // the moment the screen locks (mic + WebSocket get suspended). Best-effort:
  // unsupported browsers / battery-saver refusals are non-fatal.
  async function acquireWakeLock() {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null;
    }
  }

  // The OS silently releases the wake lock whenever the page is hidden —
  // re-acquire on return while a session is still running.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && clientRef.current) void acquireWakeLock();
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
    if (startingRef.current || clientRef.current) return; // ignore double taps / re-entry
    startingRef.current = true;
    setStatus("connecting");
    setNotice("");
    setTranscript([]);
    turnsRef.current = [];
    finalizingRef.current = false;
    setPhase("coach"); // coach greets first
    pausedRef.current = false;
    setPaused(false);
    setSuggestions(null);
    setCoachClip(null); // D1 — a new session starts with no shadowing model
    setTx({});
    startedAtRef.current = new Date().toISOString();
    sessionIdRef.current = crypto.randomUUID();
    void acquireWakeLock();

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
      // Build inside the try: composeSystemInstruction/pickVoice run here, so a
      // synchronous throw (e.g. a malformed imported scenario) is caught and the
      // finally still resets startingRef — otherwise Start would wedge.
      const client = new GeminiLiveDirect({
        apiKey,
        model: liveModel(), // ⚙️ override wins — repairable from the phone if renamed
        systemInstruction: composeSystemInstruction(scenario, profile, dueItems, weak, arcContext),
        voiceName: pickVoice(scenario.targetLanguage),
        handlers: {
          onOpen: () => setStatus("live"),
          onAudio: (pcm) => {
            if (pausedRef.current) return; // ignore late audio while paused
            engineRef.current?.playPcm(pcm);
          },
          onInterrupted: () => engineRef.current?.flushPlayback(),
          onTurnState: (t) => {
            setPhase(t); // transport is the single source of truth
            // D1 — bracket the coach's turn so its audio can be shadowed. The
            // clip is only offered once the turn ENDS (a cut-off turn is dropped
            // inside flushPlayback), so 跟讀 always models a complete phrase.
            if (t === "coach") {
              engineRef.current?.beginCoachTurn();
              setCoachClip(null); // a new turn started — the old clip isn't「剛才那句」
            } else {
              engineRef.current?.endCoachTurn();
              setCoachClip(engineRef.current?.lastCoachTurn() ?? null);
            }
          },
          onUserTranscript: (t) => pushDelta("user", t),
          onAssistantTranscript: (t) => pushDelta("coach", t),
          onError: (m) => setNotice(`錯誤：${describeError(m)}`),
          onClose: (reason) => {
            if (finalizingRef.current) return;
            if (pausedRef.current) return; // paused: keep state; resume() will reconnect
            void teardown();
            setStatus("ready");
            // A close reason like "quota exceeded" tells the user whether
            // retrying can even work — surface it translated when we have one.
            setNotice(
              reason && reason !== "closed"
                ? `連線中斷：${describeError(reason)}`
                : "連線中斷 — 點一下重新開始。",
            );
          },
        },
      });
      clientRef.current = client; // hold the ref BEFORE connecting so an unmount
      await client.connect(); //     during connect can still tear the socket down
      const engine = new AudioEngine({
        inputSampleRate: GeminiLiveDirect.INPUT_SAMPLE_RATE,
        outputSampleRate: GeminiLiveDirect.OUTPUT_SAMPLE_RATE,
        onChunk: (pcm) => clientRef.current?.sendAudio(pcm),
        onLevel: (rms) => levelListenerRef.current?.(rms),
      });
      await engine.start();
      engine.setPlaybackRate(slow ? 0.85 : 1);
      engine.setLevelReporting(showLevel); // E2 — only pay for RMS when it's shown
      engineRef.current = engine;
    } catch (err) {
      // Silence the onClose our own teardown triggers, so the REAL cause
      // (mic denied, bad key…) survives instead of "Connection closed".
      finalizingRef.current = true;
      await teardown();
      setStatus("ready");
      setNotice(`無法開始：${describeError(err)}`);
    } finally {
      startingRef.current = false;
    }
  }

  async function teardown() {
    clientRef.current?.close();
    clientRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    await engineRef.current?.stop();
    engineRef.current = null;
  }

  function pauseSession() {
    if (pausedRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    engineRef.current?.pauseMic(); // mic off + silence coach; live socket stays open
    // keep any 卡住 suggestions visible so the learner can rehearse them while paused
  }

  async function resumeSession() {
    if (!pausedRef.current || resumingRef.current) return; // guard double-tap
    resumingRef.current = true;
    setNotice("");
    try {
      // If the socket dropped during a long pause, reconnect & continue the
      // same conversation via the resumption handle.
      if (clientRef.current && !clientRef.current.isOpen()) await clientRef.current.reconnect();
      pausedRef.current = false; // let resumed coach audio through before mic is back
      await engineRef.current?.resumeMic();
      setPaused(false);
    } catch (err) {
      pausedRef.current = true; // stay paused so the user can retry or stop
      setNotice(`無法接續：${describeError(err)}`);
    } finally {
      resumingRef.current = false;
    }
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
    engineRef.current?.setPlaybackRate(next ? 0.85 : 1);
    savePrefs({ slowSpeech: next, showLevelMeter: showLevel });
  }

  // E2 — remember the choice, so someone who wants the meter isn't re-enabling it
  // every session and someone who doesn't never sees it again.
  function toggleLevelMeter() {
    const next = !showLevel;
    setShowLevel(next);
    engineRef.current?.setLevelReporting(next);
    savePrefs({ slowSpeech: slow, showLevelMeter: next });
  }

  // Stable across renders — the meter uses it as an effect dependency, so a new
  // identity each render would re-subscribe on every level tick.
  const subscribeLevel = useCallback<LevelSubscribe>((listener) => {
    levelListenerRef.current = listener;
    return () => {
      if (levelListenerRef.current === listener) levelListenerRef.current = null;
    };
  }, []);

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
    await teardown();
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
        setSummary({ items: 0, review: emptyReview(scenario) });
      }
    }
    setStatus("done");
  }

  const busy = status === "live" || status === "connecting" || status === "saving";

  return (
    <main className="app">
      <div className="topbar">
        <button className="btn btn--ghost btn--sm" onClick={props.onExit} disabled={busy}>
          ← 返回
        </button>
        <span className="grow" />
        <span className={`pill ${paused ? "pill--warn" : status === "live" ? "pill--live" : "pill--neutral"}`}>
          {paused ? "已暫停" : STATUS_LABEL[status]}
        </span>
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
                <span className="mic-emoji">{paused ? "⏸" : phase === "coach" ? "🔊" : "🎤"}</span>
                {paused ? "已暫停" : phase === "coach" ? "教練說話中" : "換你說"}
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
          ) : (
            <>
              <button className="mic-btn" onClick={start} disabled={status === "connecting"}>
                <span className="mic-emoji">🎙️</span>
                {status === "connecting" ? "連線中…" : "開始"}
              </button>
              {status === "connecting" && <p className="muted">會請求麥克風權限，請允許</p>}
            </>
          )}
        </div>
      )}

      {/* Done summary */}
      {status === "done" && summary && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>已儲存本次練習</b>
            <span className="pill pill--neutral">CEFR {summary.review.cefr}</span>
          </div>
          {summary.review.subscores && (
            <p className="muted" style={{ marginTop: 8 }}>
              文法 {band(summary.review.subscores.grammar)}・詞彙 {band(summary.review.subscores.vocab)}・
              流暢 {band(summary.review.subscores.fluency)}・互動 {band(summary.review.subscores.interaction)}
            </p>
          )}
          {summary.review.reviewZh && <p className="muted">{summary.review.reviewZh}</p>}
          {summary.review.reviewEn && <p className="muted">{summary.review.reviewEn}</p>}
          {summary.review.objectivesMet && summary.review.objectivesMet.length > 0 && (
            <CanDoSelfCheck scenarioId={scenario.id} objectives={summary.review.objectivesMet} />
          )}
          {summary.review.wins?.map((w, i) => (
            <div key={`w${i}`} className="muted">
              👍 {w}
            </div>
          ))}
          {summary.review.fixes?.map((f, i) => (
            <div key={`f${i}`} className="muted">
              🔧 {f}
            </div>
          ))}
          {/* E1 — one line naming the error TYPES confirmed this session (each
              survived a majority vote across the judge samples). One line, not a
              dashboard: the value is that these accumulate and steer the coach. */}
          {summary.review.errors && summary.review.errors.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              📌 這次的錯誤型態：
              {summary.review.errors.map((e) => ERROR_TYPE_LABEL[e.type]).join("・")}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            已新增 {summary.items} 個單字／語句到你的詞庫。
          </p>
          {summary.review.progressNote && (
            <p className="muted">↪ 下次重點：{summary.review.progressNote}</p>
          )}
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
