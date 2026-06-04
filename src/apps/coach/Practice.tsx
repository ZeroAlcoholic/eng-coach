// Live spoken practice for one scenario. Reuses the proven audio + direct-Gemini
// transport; on stop it finalises: save the session, extract LearnedItems into
// the shared kernel, and refresh the scenario's rolling progress note.
//
// In-car UX: one big circular mic button is the whole control surface — start
// is a large green target, stop is a large red one, status is glanceable.

import { useEffect, useRef, useState } from "react";

import { AudioEngine } from "../../audio/AudioEngine";
import { GeminiLiveDirect } from "../../api/gemini-direct";
import { putItems, putScenario, putSession } from "../../kernel/db";
import type { LearnerProfile, Scenario, TranscriptTurn } from "../../kernel/types";
import { extractLearnedItems, summariseSession, type SessionReview } from "./ai";
import { composeSystemInstruction } from "./prompt";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";

type Status = "ready" | "connecting" | "live" | "saving" | "done";

const STATUS_LABEL: Record<Status, string> = {
  ready: "Ready",
  connecting: "Connecting…",
  live: "Listening",
  saving: "Analysing…",
  done: "Done",
};

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

  const engineRef = useRef<AudioEngine | null>(null);
  const clientRef = useRef<GeminiLiveDirect | null>(null);
  const startedAtRef = useRef<string>("");
  const finalizingRef = useRef(false);
  const startingRef = useRef(false); // guards the async start() window against re-entry
  const turnsRef = useRef<TranscriptTurn[]>([]);

  // Authoritative safety net: tear down mic + WebSocket if the screen unmounts
  // for any reason (not just the guarded Back button). finalizingRef is set so
  // the resulting onClose doesn't try to setState on an unmounted component.
  useEffect(() => {
    return () => {
      finalizingRef.current = true;
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setNotice("No API key — set it on the home screen first.");
      return;
    }
    if (startingRef.current || clientRef.current) return; // ignore double taps / re-entry
    startingRef.current = true;
    setStatus("connecting");
    setNotice("");
    setTranscript([]);
    turnsRef.current = [];
    finalizingRef.current = false;
    startedAtRef.current = new Date().toISOString();

    const client = new GeminiLiveDirect({
      apiKey,
      model: LIVE_MODEL,
      systemInstruction: composeSystemInstruction(scenario, profile),
      handlers: {
        onOpen: () => setStatus("live"),
        onAudio: (pcm) => engineRef.current?.playPcm(pcm),
        onInterrupted: () => engineRef.current?.flushPlayback(),
        onUserTranscript: (t) => pushDelta("user", t),
        onAssistantTranscript: (t) => pushDelta("coach", t),
        onError: (m) => setNotice(`Error: ${m}`),
        onClose: () => {
          if (finalizingRef.current) return;
          void teardown();
          setStatus("ready");
          setNotice("Connection closed — tap to resume.");
        },
      },
    });

    try {
      await client.connect();
      clientRef.current = client;
      const engine = new AudioEngine({
        inputSampleRate: GeminiLiveDirect.INPUT_SAMPLE_RATE,
        outputSampleRate: GeminiLiveDirect.OUTPUT_SAMPLE_RATE,
        onChunk: (pcm) => clientRef.current?.sendAudio(pcm),
      });
      await engine.start();
      engineRef.current = engine;
    } catch (err) {
      // Silence the onClose our own teardown triggers, so the REAL cause
      // (mic denied, bad key…) survives instead of "Connection closed".
      finalizingRef.current = true;
      await teardown();
      setStatus("ready");
      setNotice(`Couldn't start: ${err instanceof Error ? err.message : String(err)}`);
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
      // Save the transcript first (cheap, local) so a later AI/analysis failure
      // never loses the session.
      await putSession({
        id: sessionId,
        scenarioId: scenario.id,
        startedAt: startedAtRef.current,
        transcript: turns,
      });
      if (turns.length) {
        const [items, review] = await Promise.all([
          extractLearnedItems(apiKey, { scenario, sessionId, transcript: turns }),
          summariseSession(apiKey, { transcript: turns, level: scenario.level, previous: scenario.progressNote }),
        ]);
        if (items.length) await putItems(items);
        await putScenario({ ...scenario, progressNote: review.progressNote });
        setSummary({ items: items.length, review });
      } else {
        setSummary({ items: 0, review: emptyReview });
      }
    } catch (err) {
      setNotice(`Saved with issues: ${err instanceof Error ? err.message : String(err)}`);
      setSummary({ items: 0, review: emptyReview });
    }
    setStatus("done");
  }

  const busy = status === "live" || status === "connecting" || status === "saving";

  return (
    <main className="app">
      <div className="topbar">
        <button className="btn btn--ghost btn--sm" onClick={props.onExit} disabled={busy}>
          ← Back
        </button>
        <span className="grow" />
        <span className={`pill ${status === "live" ? "pill--live" : "pill--neutral"}`}>
          {STATUS_LABEL[status]}
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
            <p className="muted">Analysing your session…</p>
          ) : status === "live" ? (
            <button className="mic-btn mic-btn--stop mic-btn--live" onClick={stopAndFinalize}>
              <span className="mic-emoji">⏹</span>
              Stop &amp; save
            </button>
          ) : (
            <button className="mic-btn" onClick={start} disabled={status === "connecting"}>
              <span className="mic-emoji">🎙️</span>
              {status === "connecting" ? "Connecting…" : "Start"}
            </button>
          )}
        </div>
      )}

      {/* Done summary */}
      {status === "done" && summary && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Session saved</b>
            <span className="pill pill--neutral">CEFR {summary.review.cefr}</span>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {summary.items} vocabulary / phrase items added to your library.
          </p>
          {summary.review.reviewEn && <p className="muted">{summary.review.reviewEn}</p>}
          {summary.review.reviewZh && <p className="muted">{summary.review.reviewZh}</p>}
          {summary.review.progressNote && (
            <p className="muted">↪ Next time: {summary.review.progressNote}</p>
          )}
          <button className="btn btn--primary btn--block" style={{ marginTop: 12 }} onClick={props.onExit}>
            Done
          </button>
        </div>
      )}

      <div className="section-title">Transcript</div>
      <div className="card transcript">
        {transcript.length === 0 && <span className="muted">Your conversation will appear here…</span>}
        {transcript.map((t, i) => (
          <div key={i} className={`turn ${t.who === "user" ? "turn--you" : "turn--coach"}`}>
            <span className="turn-who">{t.who === "user" ? "you" : "coach"}</span>
            <span className="turn-text">{t.text}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
