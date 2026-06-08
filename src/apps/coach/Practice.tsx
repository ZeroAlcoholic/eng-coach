// Live spoken practice for one scenario. Reuses the proven audio + direct-Gemini
// transport; on stop it finalises: save the session, extract LearnedItems into
// the shared kernel, and refresh the scenario's rolling progress note.
//
// In-car UX: one big circular mic button is the whole control surface — start
// is a large green target, stop is a large red one, status is glanceable.

import { useEffect, useRef, useState } from "react";

import { AudioEngine } from "../../audio/AudioEngine";
import { GeminiLiveDirect } from "../../api/gemini-direct";
import { putItems, putProfile, putScenario, putSession } from "../../kernel/db";
import type { LearnerProfile, Scenario, TranscriptTurn } from "../../kernel/types";
import {
  extractLearnedItems,
  suggestReplies,
  summariseSession,
  translateLine,
  type ReplySuggestion,
  type SessionReview,
} from "./ai";
import { applySessionToProfile } from "./progress";
import { composeSystemInstruction } from "./prompt";
import { pickVoice } from "./voices";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";

type Status = "ready" | "connecting" | "live" | "saving" | "done";

const STATUS_LABEL: Record<Status, string> = {
  ready: "準備好",
  connecting: "連線中…",
  live: "練習中",
  saving: "分析中…",
  done: "完成",
};

// Per-skill subscore (1–6) → CEFR band for display.
const BANDS = ["—", "A1", "A2", "B1", "B2", "C1", "C2"];
const band = (n: number): string => BANDS[n] ?? "—";

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
  // tapped-line translations, keyed by index but tagged with the source text so a
  // still-growing streamed line doesn't show a stale partial translation.
  const [tx, setTx] = useState<Record<number, { src: string; zh: string }>>({});

  const engineRef = useRef<AudioEngine | null>(null);
  const pausedRef = useRef(false);
  const resumingRef = useRef(false); // guards double-tap on ▶ 接續
  const clientRef = useRef<GeminiLiveDirect | null>(null);
  const startedAtRef = useRef<string>("");
  const finalizingRef = useRef(false);
  const startingRef = useRef(false); // guards the async start() window against re-entry
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Authoritative safety net: tear down mic + WebSocket if the screen unmounts
  // for any reason (not just the guarded Back button). finalizingRef is set so
  // the resulting onClose doesn't try to setState on an unmounted component.
  useEffect(() => {
    return () => {
      finalizingRef.current = true;
      void teardown();
    };
  }, []);

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
    setTx({});
    startedAtRef.current = new Date().toISOString();

    try {
      // Build inside the try: composeSystemInstruction/pickVoice run here, so a
      // synchronous throw (e.g. a malformed imported scenario) is caught and the
      // finally still resets startingRef — otherwise Start would wedge.
      const client = new GeminiLiveDirect({
        apiKey,
        model: LIVE_MODEL,
        systemInstruction: composeSystemInstruction(scenario, profile),
        voiceName: pickVoice(scenario.targetLanguage),
        handlers: {
          onOpen: () => setStatus("live"),
          onAudio: (pcm) => {
            if (pausedRef.current) return; // ignore late audio while paused
            engineRef.current?.playPcm(pcm);
          },
          onInterrupted: () => engineRef.current?.flushPlayback(),
          onTurnState: (t) => setPhase(t), // transport is the single source of truth
          onUserTranscript: (t) => pushDelta("user", t),
          onAssistantTranscript: (t) => pushDelta("coach", t),
          onError: (m) => setNotice(`錯誤：${m}`),
          onClose: () => {
            if (finalizingRef.current) return;
            if (pausedRef.current) return; // paused: keep state; resume() will reconnect
            void teardown();
            setStatus("ready");
            setNotice("連線中斷 — 點一下重新開始。");
          },
        },
      });
      clientRef.current = client; // hold the ref BEFORE connecting so an unmount
      await client.connect(); //     during connect can still tear the socket down
      const engine = new AudioEngine({
        inputSampleRate: GeminiLiveDirect.INPUT_SAMPLE_RATE,
        outputSampleRate: GeminiLiveDirect.OUTPUT_SAMPLE_RATE,
        onChunk: (pcm) => clientRef.current?.sendAudio(pcm),
      });
      await engine.start();
      engine.setPlaybackRate(slow ? 0.85 : 1);
      engineRef.current = engine;
    } catch (err) {
      // Silence the onClose our own teardown triggers, so the REAL cause
      // (mic denied, bad key…) survives instead of "Connection closed".
      finalizingRef.current = true;
      await teardown();
      setStatus("ready");
      setNotice(`無法開始：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      startingRef.current = false;
    }
  }

  async function teardown() {
    clientRef.current?.close();
    clientRef.current = null;
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
      setNotice(`無法接續：${err instanceof Error ? err.message : String(err)}`);
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

  function toggleSpeed() {
    const next = !slow;
    setSlow(next);
    engineRef.current?.setPlaybackRate(next ? 0.85 : 1);
    void putProfile({ ...profile, prefs: { ...profile.prefs, slowSpeech: next } });
  }

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
    await teardown();
    setStatus("saving");

    const turns = turnsRef.current;
    const sessionId = crypto.randomUUID();
    const emptyReview: SessionReview = {
      cefr: scenario.level,
      reviewEn: "",
      reviewZh: "",
      progressNote: scenario.progressNote ?? "",
    };

    try {
      // Transcript first (cheap, local) so a later AI failure never loses it.
      const session = {
        id: sessionId,
        scenarioId: scenario.id,
        startedAt: startedAtRef.current,
        transcript: turns,
      };
      await putSession(session);
      if (turns.length) {
        const [items, review] = await Promise.all([
          extractLearnedItems(apiKey, { scenario, sessionId, transcript: turns }),
          summariseSession(apiKey, {
            transcript: turns,
            level: scenario.level,
            previous: scenario.progressNote,
            objectives: scenario.objectives,
          }),
        ]);
        if (items.length) await putItems(items);
        await putScenario({ ...scenario, progressNote: review.progressNote });
        await putSession({ ...session, review }); // persist the recap on the session
        // W1 — fold this session's subscores into the remembered per-skill level
        // (merge the current slow-speech pref so it isn't clobbered).
        await putProfile(
          applySessionToProfile(
            { ...profile, prefs: { ...profile.prefs, slowSpeech: slow } },
            review,
            new Date().toISOString(),
          ),
        );
        setSummary({ items: items.length, review });
      } else {
        setSummary({ items: 0, review: emptyReview });
      }
    } catch (err) {
      setNotice(`已儲存，但分析失敗：${err instanceof Error ? err.message : String(err)}`);
      setSummary({ items: 0, review: emptyReview });
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
                </div>
              )}
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
            <div style={{ margin: "10px 0" }}>
              {summary.review.objectivesMet.map((o, i) => (
                <div key={i} className="muted">
                  {o.met ? "✅" : "⬜"} {o.objective}
                </div>
              ))}
            </div>
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
