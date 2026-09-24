// The single owner of a live practice's resources: the Gemini transport, the
// audio engine, the screen wake lock, and the right to say whose turn it is.
//
// Why one owner and a generation counter: starting a session is three awaits
// (connect, mic, worklet) and the learner can Stop, go Back or unmount between
// any two of them. Each await re-checks the generation it started under; a
// mismatch means Stop won, so the resource just acquired is released instead
// of stored. Callbacks from a superseded transport are dropped the same way, so
// an old session's late「連線中斷」can never re-label a new one.
//
// The UI depends on this file only — never on the SDK or on the concrete
// transport/engine, which are injected (defaults at the bottom).

import type { GeminiDirectHandlers } from "../../api/gemini-direct";
import { GeminiLiveDirect } from "../../api/gemini-direct";
import { AudioEngine, type CoachClip } from "../../audio/AudioEngine";
import { describeError } from "../../kernel/errors";

export type { CoachClip };

export type Turn = "coach" | "you";

export type SessionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "awaiting-mic" }
  | { kind: "live"; paused: boolean; reconnecting: boolean }
  | { kind: "stopping" }
  | { kind: "ended"; by: "user" }
  | { kind: "ended"; by: "start-failed"; reason: unknown }
  | { kind: "ended"; by: "connection"; reason: string };

export interface SessionListener {
  onPhase: (phase: SessionPhase) => void;
  // The cue the learner sees. "you" fires only when the coach's audio has
  // actually finished playing (or was interrupted), never on the raw protocol
  // signal, so「換你說」cannot appear while the loudspeaker is still talking.
  onCue: (turn: Turn) => void;
  onTranscript: (who: "user" | "coach", text: string) => void;
  onCoachClip: (clip: CoachClip | null) => void;
  onNotice: (text: string) => void;
}

export interface TransportSpec {
  apiKey: string;
  model: string;
  systemInstruction: string;
  voiceName?: string;
}

/** What the owner needs from a transport — the protocol lives behind it. */
export interface SessionTransport {
  connect(): Promise<void>;
  sendAudio(pcm: ArrayBuffer): void;
  isOpen(): boolean;
  reconnect(): Promise<void>;
  close(): void;
}

/** What the owner needs from the audio engine. */
export interface SessionAudio {
  start(): Promise<void>;
  stop(): Promise<void>;
  playPcm(pcm: ArrayBuffer): void;
  flushPlayback(): void;
  isPlaying(): boolean;
  pauseMic(): void;
  resumeMic(): Promise<void>;
  setPlaybackRate(rate: number): void;
  setLevelReporting(on: boolean): void;
  beginCoachTurn(): void;
  endCoachTurn(): void;
  lastCoachTurn(): CoachClip | null;
}

export interface AudioCallbacks {
  onChunk: (pcm: ArrayBuffer) => void;
  onLevel: (rms: number) => void;
  onDrained: () => void;
}

export interface SessionDeps {
  createTransport: (spec: TransportSpec, handlers: GeminiDirectHandlers) => SessionTransport;
  createAudio: (callbacks: AudioCallbacks) => SessionAudio;
  // Screen wake lock; absent in unsupported browsers and in tests.
  wakeLock?: Pick<WakeLock, "request">;
}

export class PracticeSession {
  private generation = 0;
  private phase: SessionPhase = { kind: "idle" };
  private transport: SessionTransport | null = null;
  private audio: SessionAudio | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private paused = false;
  private resuming = false; // a resume() is mid-flight: a second tap must not open a second mic
  private reconnecting = false;
  private cue: Turn = "coach";
  private awaitingDrain = false; // protocol said "you", audio still playing
  private playbackRate = 1;
  private levelReporting = false;
  private levelListener: ((rms: number) => void) | null = null;

  constructor(
    private readonly deps: SessionDeps,
    private readonly listener: SessionListener,
  ) {}

  currentPhase(): SessionPhase {
    return this.phase;
  }

  private setPhase(phase: SessionPhase): void {
    this.phase = phase;
    this.listener.onPhase(phase);
  }

  private setLivePhase(): void {
    this.setPhase({ kind: "live", paused: this.paused, reconnecting: this.reconnecting });
  }

  private setCue(turn: Turn): void {
    if (this.cue === turn) return;
    this.cue = turn;
    this.listener.onCue(turn);
  }

  /** Connect, then open the mic. Resolves once live, or once the attempt ended
   *  (failure or a Stop that overtook it); the phase stream carries which. */
  async start(spec: TransportSpec): Promise<void> {
    if (this.phase.kind !== "idle" && this.phase.kind !== "ended") return;
    const gen = ++this.generation;
    this.paused = false;
    this.reconnecting = false;
    this.awaitingDrain = false;
    this.cue = "coach";
    this.listener.onCue("coach"); // coach greets first
    this.setPhase({ kind: "connecting" });
    void this.acquireWakeLock();

    const transport = this.deps.createTransport(spec, this.transportHandlers(gen));
    this.transport = transport; // held BEFORE connecting so stop() can close it mid-flight
    try {
      await transport.connect();
      if (gen !== this.generation) return; // Stop won; stop() released it
      this.setPhase({ kind: "awaiting-mic" });

      const audio = this.deps.createAudio({
        onChunk: (pcm) => {
          if (gen === this.generation) this.transport?.sendAudio(pcm);
        },
        onLevel: (rms) => this.levelListener?.(rms),
        onDrained: () => {
          if (gen === this.generation) this.playbackDrained();
        },
      });
      this.audio = audio; // same: held before its awaits
      await audio.start();
      if (gen !== this.generation) return;
      audio.setPlaybackRate(this.playbackRate);
      audio.setLevelReporting(this.levelReporting);
      this.setLivePhase();
    } catch (reason) {
      if (gen !== this.generation) return; // a Stop already reported its own phase
      await this.release(); // never throws, so the terminal phase always follows
      this.setPhase({ kind: "ended", by: "start-failed", reason });
    }
  }

  /** Release everything, whatever phase we are in. Idempotent. A Stop during
   *  start() wins: the in-flight awaits see the bumped generation and drop
   *  whatever they were about to store. */
  async stop(): Promise<void> {
    if (this.phase.kind === "idle" || this.phase.kind === "ended") return;
    this.generation++;
    this.setPhase({ kind: "stopping" });
    await this.release();
    this.setPhase({ kind: "ended", by: "user" });
  }

  /** Never throws: a teardown error must not stop the phase stream from
   *  reaching its terminal state (the learner would be stuck at「練習中」with a
   *  dead session). The error is reported as a notice instead. */
  private async release(): Promise<void> {
    const transport = this.transport;
    const audio = this.audio;
    this.transport = null;
    this.audio = null;
    try {
      transport?.close();
    } catch (err) {
      this.listener.onNotice(`關閉連線時出錯：${describeError(err)}`);
    }
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    try {
      await audio?.stop();
    } catch (err) {
      this.listener.onNotice(`釋放麥克風時出錯：${describeError(err)}`);
    }
  }

  /** Mic off, coach silenced; the live socket stays open so resume is cheap. */
  pause(): void {
    if (this.phase.kind !== "live" || this.paused) return;
    this.paused = true;
    this.audio?.pauseMic(); // flushes playback, which is not a drain…
    if (this.awaitingDrain) {
      // …so a turn that had already completed must hand over here, or the cue
      // would say 教練說話中 after resume while the model waits for the learner.
      this.awaitingDrain = false;
      this.setCue("you");
    }
    this.setLivePhase();
  }

  /** Re-open the mic (and the socket, if it dropped meanwhile). Must be called
   *  from a user gesture. Stays paused on failure so the learner can retry. */
  async resume(): Promise<void> {
    if (this.phase.kind !== "live" || !this.paused || this.resuming) return;
    const gen = this.generation;
    this.resuming = true;
    try {
      if (this.transport && !this.transport.isOpen()) await this.transport.reconnect();
      if (gen !== this.generation) return;
      this.paused = false; // let resumed coach audio through before the mic is back
      await this.audio?.resumeMic();
      if (gen !== this.generation) return;
      this.setLivePhase();
    } catch (err) {
      if (gen !== this.generation) return;
      this.paused = true;
      this.listener.onNotice(`無法接續：${describeError(err)}`);
    } finally {
      this.resuming = false;
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    this.audio?.setPlaybackRate(rate);
  }

  setLevelReporting(on: boolean): void {
    this.levelReporting = on;
    this.audio?.setLevelReporting(on);
  }

  /** One listener at a time (the meter); returns the unsubscribe. */
  subscribeLevel(listener: (rms: number) => void): () => void {
    this.levelListener = listener;
    return () => {
      if (this.levelListener === listener) this.levelListener = null;
    };
  }

  /** The OS drops the wake lock whenever the page is hidden — call on return. */
  pageVisible(): void {
    if (this.transport) void this.acquireWakeLock();
  }

  private async acquireWakeLock(): Promise<void> {
    if (!this.deps.wakeLock) return;
    const gen = this.generation;
    try {
      const sentinel = await this.deps.wakeLock.request("screen");
      // The session may have been released while the request was pending; a
      // stored sentinel would then keep the screen awake with nothing running.
      if (gen !== this.generation || !this.transport) sentinel.release().catch(() => {});
      else this.wakeLock = sentinel;
    } catch {
      this.wakeLock = null; // battery saver / unsupported: non-fatal
    }
  }

  private playbackDrained(): void {
    if (!this.awaitingDrain) return;
    this.awaitingDrain = false;
    this.setCue("you");
  }

  private transportHandlers(gen: number): GeminiDirectHandlers {
    const live = () => gen === this.generation;
    return {
      onAudio: (pcm) => {
        if (!live() || this.paused) return; // late audio while paused is dropped
        this.audio?.playPcm(pcm);
      },
      onInterrupted: () => {
        if (!live()) return;
        this.audio?.flushPlayback();
        this.awaitingDrain = false;
        this.setCue("you"); // barge-in: the learner is already talking
      },
      onTurnState: (turn) => {
        if (!live()) return;
        if (turn === "coach") {
          this.awaitingDrain = false;
          this.audio?.beginCoachTurn();
          this.listener.onCoachClip(null); // a new turn: the old clip isn't「剛才那句」
          this.setCue("coach");
          return;
        }
        this.audio?.endCoachTurn();
        this.listener.onCoachClip(this.audio?.lastCoachTurn() ?? null);
        if (this.audio?.isPlaying()) this.awaitingDrain = true;
        else this.setCue("you");
      },
      onUserTranscript: (text) => {
        if (live()) this.listener.onTranscript("user", text);
      },
      onAssistantTranscript: (text) => {
        if (live()) this.listener.onTranscript("coach", text);
      },
      onError: (message) => {
        if (live()) this.listener.onNotice(`錯誤：${describeError(message)}`);
      },
      onReconnecting: () => {
        if (!live() || this.phase.kind !== "live") return;
        this.reconnecting = true;
        this.setLivePhase();
      },
      onResumed: (resumed) => {
        if (!live() || this.phase.kind !== "live") return;
        this.reconnecting = false;
        this.setLivePhase();
        if (!resumed) this.listener.onNotice("連線已重建，但教練可能不記得前段對話。");
      },
      onClose: (reason) => {
        if (!live()) return;
        this.reconnecting = false; // a failed hand-over lands here too; the flag must not outlive it
        if (this.paused) {
          this.setLivePhase();
          return; // resume() reconnects via the handle
        }
        // A close before live means the server rejected setup (model name or a
        // feature flag) — a start that failed, not a conversation that dropped.
        const ended: SessionPhase =
          this.phase.kind === "live"
            ? { kind: "ended", by: "connection", reason }
            : {
                kind: "ended",
                by: "start-failed",
                reason: reason && reason !== "closed" ? reason : "伺服器在完成設定前關閉了連線（模型名稱或功能可能不被接受）",
              };
        const endedGen = ++this.generation; // nothing from this session may arrive after this
        void this.release().then(() => {
          // stop() may have run during release(): it already reported ended:user
          if (endedGen === this.generation) this.setPhase(ended);
        });
      },
    };
  }
}

/** Production wiring: the real Gemini transport and Web Audio engine. */
export const defaultSessionDeps: SessionDeps = {
  createTransport: (spec, handlers) => new GeminiLiveDirect({ ...spec, handlers }),
  createAudio: (callbacks) =>
    new AudioEngine({
      inputSampleRate: GeminiLiveDirect.INPUT_SAMPLE_RATE,
      outputSampleRate: GeminiLiveDirect.OUTPUT_SAMPLE_RATE,
      ...callbacks,
    }),
  // Wrapped rather than passed as `navigator.wakeLock`: calling `request` off
  // the object throws "Illegal invocation".
  wakeLock:
    typeof navigator !== "undefined" && navigator.wakeLock
      ? { request: (type) => navigator.wakeLock.request(type) }
      : undefined,
};
