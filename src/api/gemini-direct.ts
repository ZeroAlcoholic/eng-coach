// Path B: the browser talks DIRECTLY to the Gemini Live API with the user's own
// key — no relay in the loop. The key lives in the browser; for a single user
// with their own capped key that is a proportionate trade (project_deployment
// memory, Path B).
//
// This file owns exactly one thing: the Live WebSocket protocol — setup config,
// message parsing, session resumption and the GoAway hand-over. It knows nothing
// about audio devices or UI; it hands PCM16 ArrayBuffers out and takes them in.
//
// Audio contract: PCM16 LE, 16kHz in / 24kHz out. The SDK wants base64 strings
// on its boundary, so the conversion happens here.

import { GoogleGenAI, Modality } from "@google/genai";
import type {
  LiveCallbacks,
  LiveConnectConfig,
  LiveSendRealtimeInputParameters,
  LiveServerMessage,
} from "@google/genai";

const INPUT_SAMPLE_RATE = 16000; // Gemini Live expects 16kHz PCM16 in
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live produces 24kHz PCM16 out
// A hand-over that neither opens nor errors (mobile network switching) must not
// leave the UI at「重新連線中…」forever; past this it is a failed hand-over.
const HANDOVER_TIMEOUT_MS = 15_000;
// Mic audio buffered before setupComplete / during a hand-over. 16 kHz PCM16 is
// 32 KB/s, so this is ~10 s of speech; older chunks are dropped, not the socket.
const MAX_PENDING_AUDIO_BYTES = 320_000;

export interface GeminiDirectHandlers {
  onAudio: (pcm: ArrayBuffer) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onInterrupted?: () => void; // barge-in: model was cut off, flush playback
  // Whose turn at the PROTOCOL level: "coach" = model is generating audio,
  // "you" = the model has finished its turn. Audio may still be playing locally
  // when "you" fires — the session owner combines this with playback drain.
  onTurnState?: (turn: "coach" | "you") => void;
  onOpen?: () => void;
  // The server announced it will drop the connection (GoAway); a resumed
  // connection is being opened. Audio sent meanwhile is buffered.
  onReconnecting?: () => void;
  // The resumed connection is up. `resumed` is false when no resumption handle
  // had been issued yet, so the model starts the conversation over.
  onResumed?: (resumed: boolean) => void;
  // The connection is gone for good (not a GoAway hand-over, not a user close).
  onClose?: (reason: string) => void;
  onError?: (message: string) => void;
}

/** Model-side conversation features. Both are supported by `gemini-3.8-live`
 *  and independent of the prompt; a model that lacks one rejects setup. */
export interface LiveFeatures {
  proactiveAudio: boolean; // model may stay silent on non-addressed speech
  affectiveDialog: boolean; // model adapts tone to the learner's
}

export const DEFAULT_LIVE_FEATURES: LiveFeatures = { proactiveAudio: true, affectiveDialog: true };

/** The slice of the SDK's `Session` this transport needs. Kept minimal so a
 *  test can stand in at exactly this boundary and nothing else. */
export interface LiveSocket {
  sendRealtimeInput(input: LiveSendRealtimeInputParameters): void;
  close(): void;
}

export interface LiveConnectRequest {
  model: string;
  config: LiveConnectConfig;
  callbacks: LiveCallbacks;
}

export type LiveConnector = (req: LiveConnectRequest) => Promise<LiveSocket>;

export interface GeminiDirectOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voiceName?: string; // prebuilt Gemini voice; omitted = API default (Puck)
  features?: LiveFeatures;
  handlers: GeminiDirectHandlers;
  // Injection point for tests. Production uses the SDK.
  connector?: LiveConnector;
  // Injection point for tests; production uses setTimeout.
  handoverTimeoutMs?: number;
}

function sdkConnector(apiKey: string): LiveConnector {
  const ai = new GoogleGenAI({ apiKey });
  return (req) => ai.live.connect(req);
}

export class GeminiLiveDirect {
  static readonly INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;
  static readonly OUTPUT_SAMPLE_RATE = OUTPUT_SAMPLE_RATE;

  private socket: LiveSocket | null = null;
  // Gemini only honours realtime input AFTER it sends `setupComplete`. Anything
  // streamed before that can be silently dropped, so we buffer and flush on ready.
  private ready = false;
  private readonly pendingAudio: ArrayBuffer[] = [];
  private turn: "coach" | "you" = "you"; // coach greets first; first audio flips to "coach"
  private resumeHandle: string | null = null; // issued by the server; survives sockets
  private reconnecting = false; // a GoAway hand-over is in flight
  private closedByUser = false; // close() was called: no hand-over may follow
  private readonly connector: LiveConnector;
  private readonly opts: GeminiDirectOptions;

  constructor(opts: GeminiDirectOptions) {
    this.opts = opts;
    this.connector = opts.connector ?? sdkConnector(opts.apiKey);
  }

  /** Emit a turn transition once (no spam while a turn continues). */
  private setTurn(t: "coach" | "you"): void {
    if (this.turn === t) return;
    this.turn = t;
    this.opts.handlers.onTurnState?.(t);
  }

  async connect(): Promise<void> {
    this.turn = "you";
    this.ready = false;
    this.closedByUser = false;
    const socket = await this.openSocket();
    if (this.closedByUser) {
      // close() ran while the socket was opening: it must not outlive the
      // session that asked for it, and storing it would resurrect that session.
      socket.close();
      return;
    }
    this.socket = socket;
  }

  /** Open one socket. Every callback is bound to THIS socket, so after a
   *  hand-over the old socket's late onclose/onmessage cannot touch the new
   *  session's state — that is what `socket === opened` guards. */
  private async openSocket(): Promise<LiveSocket> {
    const { handlers } = this.opts;
    const features = this.opts.features ?? DEFAULT_LIVE_FEATURES;
    let opened: LiveSocket | null = null;
    const isCurrent = () => opened !== null && this.socket === opened;
    opened = await this.connector({
      model: this.opts.model,
      config: {
        responseModalities: [Modality.AUDIO],
        // Transcribe both sides so the UI can show the conversation.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Resumption: the server issues handles as the conversation grows; a
        // later connect with the handle continues the same conversation.
        sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
        // Without compression the server ends the session at its context limit.
        // A sliding window keeps the system instruction and the recent turns;
        // an empty window object means "server defaults".
        contextWindowCompression: { slidingWindow: {} },
        proactivity: { proactiveAudio: features.proactiveAudio },
        enableAffectiveDialog: features.affectiveDialog,
        systemInstruction: this.opts.systemInstruction,
        // Native-audio model => no languageCode (accent is voice + prompt driven).
        ...(this.opts.voiceName
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.opts.voiceName } } } }
          : {}),
      },
      callbacks: {
        onopen: () => handlers.onOpen?.(),
        onmessage: (m: LiveServerMessage) => {
          if (isCurrent()) this.handleMessage(m);
        },
        onerror: (e: ErrorEvent) => {
          // Browsers hand back "" for network-level errors; the close reason
          // that follows carries the real diagnosis.
          if (isCurrent()) handlers.onError?.(e?.message || "WebSocket 錯誤，關閉原因隨後顯示");
        },
        onclose: (e: CloseEvent) => {
          if (!isCurrent()) return; // superseded or already closed on purpose
          this.socket = null; // so isOpen() is accurate and reconnect() can fire
          handlers.onClose?.(e?.reason ?? "closed");
        },
      },
    });
    return opened;
  }

  /** Stream one PCM16 chunk (from AudioEngine.onChunk) to the model. */
  sendAudio(pcm: ArrayBuffer): void {
    if (!this.socket && !this.reconnecting) return;
    if (!this.ready) {
      this.bufferAudio(pcm); // flushed once setupComplete arrives
      return;
    }
    this.pushAudio(pcm);
  }

  private bufferAudio(pcm: ArrayBuffer): void {
    this.pendingAudio.push(pcm);
    let bytes = this.pendingAudio.reduce((n, b) => n + b.byteLength, 0);
    while (bytes > MAX_PENDING_AUDIO_BYTES && this.pendingAudio.length > 1) {
      bytes -= this.pendingAudio.shift()!.byteLength;
    }
  }

  // The `audio` field is the current realtime-input channel. The older `media`
  // field maps to `realtime_input.media_chunks`, which the server rejects.
  private pushAudio(pcm: ArrayBuffer): void {
    this.socket?.sendRealtimeInput({
      audio: {
        data: arrayBufferToBase64(pcm),
        mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
      },
    });
  }

  private handleMessage(m: LiveServerMessage): void {
    const { handlers } = this.opts;

    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    }

    if (m.setupComplete && !this.ready) {
      this.ready = true;
      for (const chunk of this.pendingAudio.splice(0)) this.pushAudio(chunk);
    }

    if (m.goAway) {
      void this.handOver();
      return;
    }

    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        handlers.onInterrupted?.();
        this.setTurn("you"); // model was cut off → learner's turn
      }
      if (sc.inputTranscription?.text) handlers.onUserTranscript?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) {
        handlers.onAssistantTranscript?.(sc.outputTranscription.text);
      }
    }

    // `.data` concatenates all inline-data (audio) parts of this message.
    const audioB64 = m.data;
    if (audioB64) {
      // Announce the turn BEFORE handing over the audio: consumers bracket a
      // coach turn on this transition (shadowing captures the turn's audio), so
      // emitting the audio first would drop the opening of every phrase.
      this.setTurn("coach");
      handlers.onAudio(base64ToArrayBuffer(audioB64));
    }
    // Evaluated AFTER audio: the final audio chunk often rides in the SAME
    // message as turnComplete, and the protocol-level turn is over either way.
    if (sc?.turnComplete) this.setTurn("you");
  }

  /** GoAway: the server will drop this socket within `timeLeft`. Retire it now
   *  and open a resumed socket. Only ONE attempt per GoAway — a failed
   *  hand-over reports through onClose so the owner can stop cleanly, instead of
   *  hammering a server that has just said it is going away. */
  private async handOver(): Promise<void> {
    if (this.reconnecting || this.closedByUser) return;
    const { handlers } = this.opts;
    const retiring = this.socket;
    this.reconnecting = true;
    this.socket = null; // retiring socket's callbacks are now ignored
    this.ready = false;
    if (this.turn === "coach") {
      // The rest of this turn (audio and its turnComplete) dies with the
      // retiring socket; the resumed one will not complete a turn it never
      // generated. Treat it like a barge-in so the cue and the shadowing
      // capture close cleanly.
      handlers.onInterrupted?.();
      this.setTurn("you");
    }
    handlers.onReconnecting?.();
    closeQuietly(retiring);
    let timedOut = false;
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => {
        timedOut = true;
        reject(new Error("重新連線逾時"));
      }, this.opts.handoverTimeoutMs ?? HANDOVER_TIMEOUT_MS),
    );
    // A socket that opens after the deadline (or after the user's Stop) must not
    // outlive the session it was opened for, and must never be adopted.
    const opening = this.openSocket().then((next) => {
      if (timedOut || this.closedByUser) {
        closeQuietly(next);
        return null;
      }
      return next;
    });
    try {
      const next = await Promise.race([opening, deadline]);
      if (!next) return; // user stopped while the hand-over was in flight
      this.socket = next;
      handlers.onResumed?.(this.resumeHandle !== null);
    } catch (err) {
      this.pendingAudio.length = 0;
      if (this.closedByUser) return; // a Stop is not a drop, whatever the socket did
      handlers.onClose?.(err instanceof Error ? err.message : String(err));
    } finally {
      this.reconnecting = false;
    }
  }

  /** Is the live socket open (or a hand-over in flight)? */
  isOpen(): boolean {
    return this.socket !== null || this.reconnecting;
  }

  /** Re-open after the socket dropped during a pause, resuming the SAME
   *  conversation via the stored resumption handle. */
  async reconnect(): Promise<void> {
    if (this.isOpen()) return;
    await this.connect();
  }

  close(): void {
    this.closedByUser = true;
    // Tell the model the mic stream ended so it doesn't wait for more speech.
    try {
      this.socket?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      /* session may already be gone */
    }
    const closing = this.socket;
    // Clear first: the socket's onclose sees `socket !== closing` and stays silent,
    // so a user Stop never reads as「連線中斷」.
    this.socket = null;
    this.ready = false;
    this.turn = "you";
    this.pendingAudio.length = 0;
    closeQuietly(closing);
  }
}

/** `WebSocket.close()` throws on an already-invalid socket; at teardown that
 *  carries no information anyone can act on. */
function closeQuietly(socket: LiveSocket | null): void {
  try {
    socket?.close();
  } catch {
    /* already gone */
  }
}

// --- base64 <-> ArrayBuffer at the SDK boundary (chunked to dodge call-stack
// limits on large PCM blocks). ---

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
