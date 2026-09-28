// F1 — a scripted learner at the SessionAudio boundary. Where the real engine
// opens a microphone and a loudspeaker, this one feeds pre-synthesised PCM
// into the session's onChunk at microphone pace and "plays" the coach's audio
// by counting its duration on a clock, so PracticeSession sees exactly the
// callbacks a phone would send — without a device. Nothing here decides how a
// session behaves; the transport, the owner and the pipeline under test are
// the real ones.
//
// It is a scripted stand-in, not a learner: the lines it speaks are fixed by
// the test (F2 synthesises them once), never chosen by a model.

import type { CoachClip } from "../../../audio/AudioEngine";
import { pcm16ToFloat32 } from "../../../audio/pcm";
import type { AudioCallbacks, SessionAudio } from "../session";

const INPUT_RATE = 16_000;
const FRAME_SAMPLES = 320; // 20 ms at 16 kHz — the real capture worklet's cadence
const TRAILING_SILENCE_MS = 600; // lets the model's VAD see the end of the utterance

export interface Clock {
  now: () => number; // ms
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

export class SyntheticLearnerAudio implements SessionAudio {
  private started = false;
  private micPaused = false;
  private playbackEndsAt = 0; // clock time when the queued coach audio runs out
  private drainTimer: number | null = null;
  private rate = 1;
  private capturing: Float32Array[] | null = null;
  private capturedLength = 0;
  private lastTurn: CoachClip | null = null;
  private readonly frames: number[] = []; // pending say() frame timers

  private speaking = false;
  private idleTimer: number | null = null;

  constructor(
    private readonly callbacks: AudioCallbacks,
    private readonly outputRate: number,
    private readonly clock: Clock = realClock,
    // A real microphone streams silence between utterances; the model's voice
    // activity detection is tuned to that. On by default for a live run, off
    // in the unit tests where every frame is counted.
    private readonly idleSilence = false,
  ) {}

  // --- SessionAudio -------------------------------------------------------

  start(): Promise<void> {
    this.started = true;
    if (this.idleSilence) this.scheduleIdleFrame();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.started = false;
    this.flushPlayback();
    for (const id of this.frames.splice(0)) this.clock.clearTimeout(id);
    if (this.idleTimer !== null) {
      this.clock.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    return Promise.resolve();
  }

  private scheduleIdleFrame(): void {
    this.idleTimer = this.clock.setTimeout(() => {
      this.idleTimer = null;
      if (!this.started) return;
      if (!this.speaking && !this.micPaused) this.callbacks.onChunk(new ArrayBuffer(FRAME_SAMPLES * 2));
      this.scheduleIdleFrame();
    }, 20);
  }

  /** Coach audio: accounted for by duration, and drained on the clock. */
  playPcm(pcm: ArrayBuffer): void {
    const samples = pcm.byteLength / 2;
    const ms = (samples / this.outputRate) * 1000 / this.rate;
    const now = this.clock.now();
    this.playbackEndsAt = Math.max(this.playbackEndsAt, now) + ms;
    if (this.capturing) {
      const f = pcm16ToFloat32(pcm);
      this.capturing.push(f);
      this.capturedLength += f.length;
    }
    this.scheduleDrain();
  }

  flushPlayback(): void {
    this.playbackEndsAt = 0;
    if (this.drainTimer !== null) {
      this.clock.clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  isPlaying(): boolean {
    return this.clock.now() < this.playbackEndsAt;
  }

  pauseMic(): void {
    this.micPaused = true;
    this.flushPlayback(); // the real engine silences the coach on pause too
  }

  resumeMic(): Promise<void> {
    this.micPaused = false;
    return Promise.resolve();
  }

  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }

  setLevelReporting(): void {
    // The level meter reads the microphone; a scripted learner has no loudness worth reporting.
  }

  beginCoachTurn(): void {
    this.capturing = [];
    this.capturedLength = 0;
  }

  endCoachTurn(): void {
    if (!this.capturing) return;
    const samples = new Float32Array(this.capturedLength);
    let at = 0;
    for (const chunk of this.capturing) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    this.lastTurn = samples.length ? { samples, sampleRate: this.outputRate } : null;
    this.capturing = null;
  }

  lastCoachTurn(): CoachClip | null {
    return this.lastTurn;
  }

  // --- the scripted learner ------------------------------------------------

  /** Speak one pre-synthesised line (PCM16 LE at 16 kHz): frames go to
   *  onChunk at 20 ms intervals, then 600 ms of silence. Resolves after the
   *  last frame. A paused mic swallows the frames, like a muted microphone. */
  say(pcm16k: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(pcm16k);
    const frameBytes = FRAME_SAMPLES * 2;
    const speech = Math.ceil(bytes.byteLength / frameBytes);
    const silence = Math.ceil((TRAILING_SILENCE_MS / 1000) * INPUT_RATE / FRAME_SAMPLES);
    const total = speech + silence;
    this.speaking = true;
    return new Promise((resolve) => {
      for (let i = 0; i < total; i++) {
        const id = this.clock.setTimeout(() => {
          this.frames.splice(this.frames.indexOf(id), 1);
          if (this.started && !this.micPaused) {
            const frame = i < speech ? bytes.slice(i * frameBytes, (i + 1) * frameBytes) : new Uint8Array(frameBytes);
            this.callbacks.onChunk(padded(frame, frameBytes));
          }
          if (i === total - 1) {
            this.speaking = false;
            resolve();
          }
        }, i * 20);
        this.frames.push(id);
      }
      if (total === 0) {
        this.speaking = false;
        resolve();
      }
    });
  }

  /** How many 20 ms frames say() will send for a buffer of this size. */
  static framesFor(byteLength: number): number {
    return Math.ceil(byteLength / (FRAME_SAMPLES * 2)) + Math.ceil((TRAILING_SILENCE_MS / 1000) * INPUT_RATE / FRAME_SAMPLES);
  }

  private scheduleDrain(): void {
    if (this.drainTimer !== null) this.clock.clearTimeout(this.drainTimer);
    const wait = Math.max(0, this.playbackEndsAt - this.clock.now());
    this.drainTimer = this.clock.setTimeout(() => {
      this.drainTimer = null;
      this.callbacks.onDrained();
    }, wait);
  }
}

/** The last speech frame is shorter than 20 ms; pad it so every frame the
 *  transport sees has the same size, as the worklet's do. */
function padded(frame: Uint8Array, size: number): ArrayBuffer {
  const out = new Uint8Array(new ArrayBuffer(size));
  out.set(frame.subarray(0, size));
  return out.buffer;
}
