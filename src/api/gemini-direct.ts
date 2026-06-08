// Path B spike: browser talks DIRECTLY to the Gemini Live API with the user's
// own key — NO Python relay in the loop. This is the drop-in replacement for
// RelayClient (api/ws.ts): same shape of contract (sendAudio in, onAudio out),
// but the transport is the @google/genai Live WebSocket instead of our backend.
//
// Deliberately departs from CLAUDE.md invariants #2 (backend holds all secrets)
// and #10 (zero cloud / NAS) — by user sign-off, for the personal-use PWA path.
// The key lives in the browser; for a single user with their own capped key that
// is a proportionate trade (see project_deployment memory, Path B).
//
// Audio contract matches the existing AudioEngine untouched: PCM16 LE, 16kHz in /
// 24kHz out. The SDK wants base64 strings on its boundary, so we convert here and
// hand AudioEngine raw ArrayBuffers exactly as RelayClient did.

import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";

const INPUT_SAMPLE_RATE = 16000; // Gemini Live expects 16kHz PCM16 in
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live produces 24kHz PCM16 out

export interface GeminiDirectHandlers {
  onAudio: (pcm: ArrayBuffer) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onInterrupted?: () => void; // barge-in: model was cut off, flush playback
  // Authoritative "whose turn" — the transport owns this so the UI never has to
  // race raw signals. "coach" = model speaking, "you" = learner's turn.
  onTurnState?: (turn: "coach" | "you") => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onError?: (message: string) => void;
}

export interface GeminiDirectOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voiceName?: string; // prebuilt Gemini voice; omitted = API default (Puck)
  handlers: GeminiDirectHandlers;
}

export class GeminiLiveDirect {
  static readonly INPUT_SAMPLE_RATE = INPUT_SAMPLE_RATE;
  static readonly OUTPUT_SAMPLE_RATE = OUTPUT_SAMPLE_RATE;

  private session: Session | null = null;
  // Gemini only honours realtime input AFTER it sends `setupComplete`. Anything
  // streamed before that can be silently dropped, so we buffer and flush on ready.
  private ready = false;
  private readonly pendingAudio: ArrayBuffer[] = [];
  private turn: "coach" | "you" = "you"; // coach greets first; first audio flips to "coach"
  private resumeHandle: string | null = null; // for resuming after a pause/drop
  private readonly opts: GeminiDirectOptions;

  constructor(opts: GeminiDirectOptions) {
    this.opts = opts;
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
    const ai = new GoogleGenAI({ apiKey: this.opts.apiKey });
    const { handlers } = this.opts;
    this.session = await ai.live.connect({
      model: this.opts.model,
      config: {
        responseModalities: [Modality.AUDIO],
        // Transcribe both sides so the UI can show the conversation.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Enable resumption so a pause that outlives the socket can reconnect and
        // continue the same conversation (resumeHandle is captured from updates).
        sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
        systemInstruction: this.opts.systemInstruction,
        // Pick the speaker voice. Native-audio model => no languageCode (accent
        // is voice + prompt driven). Omit speechConfig entirely if no voice.
        ...(this.opts.voiceName
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.opts.voiceName } } } }
          : {}),
      },
      callbacks: {
        onopen: () => handlers.onOpen?.(),
        onmessage: (m: LiveServerMessage) => this.handleMessage(m),
        onerror: (e: ErrorEvent) => handlers.onError?.(e?.message ?? "live error"),
        onclose: (e: CloseEvent) => {
          this.session = null; // so isOpen() is accurate and reconnect() can fire
          handlers.onClose?.(e?.reason ?? "closed");
        },
      },
    });
  }

  /** Stream one PCM16 chunk (from AudioEngine.onChunk) to the model. */
  sendAudio(pcm: ArrayBuffer): void {
    if (!this.session) return;
    if (!this.ready) {
      this.pendingAudio.push(pcm); // flushed once setupComplete arrives
      return;
    }
    this.pushAudio(pcm);
  }

  // The `audio` field is the current realtime-input channel. The older `media`
  // field maps to `realtime_input.media_chunks`, which the server now rejects
  // ("media_chunks is deprecated. Use audio, video, or text instead.").
  private pushAudio(pcm: ArrayBuffer): void {
    this.session?.sendRealtimeInput({
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
      handlers.onAudio(base64ToArrayBuffer(audioB64));
      this.setTurn("coach"); // model is speaking
    }
    // turnComplete is evaluated AFTER audio: Gemini often carries the final audio
    // chunk in the SAME message as turnComplete, so this must win → learner's turn.
    if (sc?.turnComplete) this.setTurn("you");
  }

  /** Is the live socket still open? */
  isOpen(): boolean {
    return this.session !== null;
  }

  /** Re-open after the socket dropped during a pause, resuming the SAME
   *  conversation via the stored resumption handle. */
  async reconnect(): Promise<void> {
    if (this.session) return; // already open
    await this.connect();
  }

  close(): void {
    // Tell the model the mic stream ended so it doesn't wait for more speech.
    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      /* session may already be gone */
    }
    try {
      this.session?.close();
    } finally {
      this.session = null;
      this.ready = false;
      this.turn = "you";
      this.pendingAudio.length = 0;
    }
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
