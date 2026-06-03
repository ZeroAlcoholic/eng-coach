// Path B feasibility spike UI. Single question it answers:
//   "Can the browser, with the user's own key, run a full Gemini Live voice
//    round-trip with NO Python in the loop?"
//
// Reuses AudioEngine + pcm.ts verbatim (the hard part, already proven). The only
// new thing under test is GeminiLiveDirect. The key is pasted once and kept in
// localStorage — exactly the production Path B pattern (key on the device).
//
// Throwaway diagnostic surface: inline styles, no router, no PWA. Run on
// http://localhost:5173/spike.html (localhost is a secure context, so
// getUserMedia works without HTTPS).

import { useRef, useState } from "react";

import { AudioEngine } from "../audio/AudioEngine";
import { GeminiLiveDirect } from "../api/gemini-direct";

const MODEL = "gemini-3.1-flash-live-preview"; // project's verified live model
const KEY_STORAGE = "gemini_api_key";
const SYSTEM_INSTRUCTION =
  "You are a friendly English speaking coach. Greet the user warmly in English " +
  "as soon as the session starts, then keep the conversation going with short, " +
  "natural spoken replies. Gently correct mistakes.";

type Status = "idle" | "connecting" | "live" | "error";

interface LogLine {
  who: "you" | "coach" | "sys";
  text: string;
  // Transcription arrives as a stream of small deltas. Consecutive deltas from
  // the same speaker coalesce into one line; a non-streaming line (sys, or the
  // other speaker) ends the run.
  streaming?: boolean;
}

export function SpikeApp() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<LogLine[]>([]);

  const engineRef = useRef<AudioEngine | null>(null);
  const clientRef = useRef<GeminiLiveDirect | null>(null);

  const append = (who: LogLine["who"], text: string) =>
    setLog((prev) => [...prev, { who, text }]);

  // Merge a streaming transcript delta into the current same-speaker line, or
  // start a new line when the speaker changed. Deltas are verbatim (they carry
  // their own spacing/punctuation), so concatenate raw.
  const appendDelta = (who: LogLine["who"], text: string) =>
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.who === who && last.streaming) {
        const merged = { ...last, text: last.text + text };
        return [...prev.slice(0, -1), merged];
      }
      return [...prev, { who, text, streaming: true }];
    });

  async function start() {
    if (!apiKey.trim()) {
      append("sys", "Paste your Gemini API key first.");
      return;
    }
    localStorage.setItem(KEY_STORAGE, apiKey.trim());
    setStatus("connecting");
    setLog([]);

    const client = new GeminiLiveDirect({
      apiKey: apiKey.trim(),
      model: MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      handlers: {
        onOpen: () => {
          setStatus("live");
          append("sys", "Connected to Gemini Live. Say hello.");
        },
        onAudio: (pcm) => engineRef.current?.playPcm(pcm),
        onInterrupted: () => engineRef.current?.flushPlayback(),
        onUserTranscript: (t) => appendDelta("you", t),
        onAssistantTranscript: (t) => appendDelta("coach", t),
        onError: (m) => {
          setStatus("error");
          append("sys", `ERROR: ${m}`);
        },
        onClose: (r) => {
          setStatus("idle");
          append("sys", `Closed: ${r}`);
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
      await engine.start(); // requires the user gesture we're already inside
      engineRef.current = engine;
    } catch (err) {
      setStatus("error");
      append("sys", `Failed to start: ${err instanceof Error ? err.message : String(err)}`);
      await stop();
    }
  }

  async function stop() {
    clientRef.current?.close();
    clientRef.current = null;
    await engineRef.current?.stop();
    engineRef.current = null;
    setStatus("idle");
  }

  const live = status === "live" || status === "connecting";

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Gemini Live — Direct (Path B spike)</h1>
      <p style={S.sub}>
        Browser ↔ Gemini, no backend. Status: <b style={S.status[status]}>{status}</b>
      </p>

      <input
        style={S.input}
        type="password"
        placeholder="Gemini API key (stored locally on this device)"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        disabled={live}
      />

      <div style={S.row}>
        {!live ? (
          <button style={S.btnGo} onClick={start}>
            Start talking
          </button>
        ) : (
          <button style={S.btnStop} onClick={stop}>
            Stop
          </button>
        )}
      </div>

      <div style={S.log}>
        {log.length === 0 && <div style={S.empty}>Transcript will appear here…</div>}
        {log.map((l, i) => (
          <div key={i} style={S.line[l.who]}>
            <span style={S.tag}>{l.who}</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, any> = {
  page: {
    maxWidth: 640,
    margin: "0 auto",
    padding: 24,
    fontFamily: "system-ui, sans-serif",
    color: "#e6e9f0",
    background: "#0b1020",
    minHeight: "100vh",
  },
  h1: { fontSize: 20, margin: "0 0 4px" },
  sub: { margin: "0 0 16px", color: "#9aa3b2" },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #2a3350",
    background: "#121830",
    color: "#e6e9f0",
    boxSizing: "border-box",
  },
  row: { margin: "12px 0" },
  btnGo: {
    padding: "10px 20px",
    borderRadius: 8,
    border: 0,
    background: "#3b82f6",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
  },
  btnStop: {
    padding: "10px 20px",
    borderRadius: 8,
    border: 0,
    background: "#ef4444",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
  },
  log: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    background: "#121830",
    minHeight: 200,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  empty: { color: "#5b6478" },
  tag: {
    display: "inline-block",
    minWidth: 48,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#5b6478",
  },
  line: {
    you: { color: "#7dd3fc" },
    coach: { color: "#86efac" },
    sys: { color: "#9aa3b2", fontStyle: "italic" },
  },
  status: {
    idle: { color: "#9aa3b2" },
    connecting: { color: "#fbbf24" },
    live: { color: "#86efac" },
    error: { color: "#ef4444" },
  },
};
