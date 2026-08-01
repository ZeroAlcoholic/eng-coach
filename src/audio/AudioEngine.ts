// Browser audio glue for the realtime loop (G6). Full-duplex:
//   - capture: getUserMedia -> AudioWorklet -> resample to providerInputRate ->
//     PCM16 -> onChunk (the caller streams it over the WS as a binary frame)
//   - playback: queue provider PCM16 (providerOutputRate) and schedule it
//     gaplessly on the AudioContext clock.
// echoCancellation/noiseSuppression/autoGainControl are requested so the car's
// speaker output doesn't bleed back into the mic and falsely trip VAD.
//
// This is browser-only glue (no DOM-less unit test); the math it relies on lives
// in pcm.ts and is unit-tested. Real audio is verified in the Field car test.

import { float32ToPcm16, pcm16ToFloat32, resampleLinear } from "./pcm";

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

// D1 — how much of one coach turn to keep for shadowing. A modelled phrase is a
// few seconds; the cap only stops a runaway monologue from holding megabytes.
const MAX_TURN_SECONDS = 30;

/** D1 — one captured coach turn, ready to be encoded for replay. */
export interface CoachClip {
  samples: Float32Array;
  sampleRate: number;
}

// E2 — how often the mic level is reported. ~10 Hz is enough to see your voice
// move and cheap enough that it can't compete with the audio path for cycles.
const LEVEL_INTERVAL_MS = 100;

export interface AudioEngineOptions {
  inputSampleRate: number; // provider expects (e.g. 16000 for Gemini)
  outputSampleRate: number; // provider produces (e.g. 24000 for Gemini)
  onChunk: (pcm: ArrayBuffer) => void;
  // E2 — throttled RMS of the captured mic frames, 0..1. This is LOUDNESS, not
  // stress and not a score; its honest use is "is the mic hearing me at all".
  onLevel?: (rms: number) => void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playHead = 0;
  // Scheduled-but-not-yet-finished playback nodes. Tracked so barge-in can truly
  // silence the assistant — resetting playHead alone leaves already-started
  // BufferSources audible.
  private scheduled: AudioBufferSourceNode[] = [];
  private rate = 1; // playback speed (W4 slow-speech toggle); <1 = slower
  // D1 — the coach's voice for shadowing. `capturing` accumulates the turn that
  // is playing right now; it is promoted to `lastTurn` only when the turn ENDS
  // cleanly, so a barged-in (cut short) turn is never offered as a model.
  private capturing: Float32Array[] | null = null;
  private capturedLength = 0;
  private lastTurn: CoachClip | null = null;
  private lastLevelAt = 0; // E2 — throttle stamp for the loudness callback
  private levelReporting = false; // E2 — opt-in; off until the learner asks
  private readonly opts: AudioEngineOptions;

  constructor(opts: AudioEngineOptions) {
    this.opts = opts;
  }

  /** Playback speed for the coach's voice (1 = normal, 0.85 = slower). */
  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }

  /** Must be called from a user gesture (autoplay policy). */
  async start(): Promise<void> {
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.playHead = this.ctx.currentTime;

    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    // Base-relative (NOT "/capture-worklet.js") so it resolves under a project
    // subpath like https://user.github.io/<repo>/ — an absolute path would 404
    // there and the mic would never start.
    await this.ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.ctx, "capture-processor");

    const captureRate = this.ctx.sampleRate;
    this.workletNode.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const resampled = resampleLinear(ev.data, captureRate, this.opts.inputSampleRate);
      this.opts.onChunk(float32ToPcm16(resampled));
      this.reportLevel(ev.data);
    };
    this.source.connect(this.workletNode);
    // Worklet has no output we want audible; do not connect to destination.
  }

  /** E2 — turn the loudness callback on/off at runtime. The meter is opt-in and
   *  can be toggled mid-session, so the engine is told explicitly rather than
   *  paying for the RMS pass on every frame just in case. */
  setLevelReporting(on: boolean): void {
    this.levelReporting = on;
  }

  // E2 — throttled RMS out of the frames we are already handing to the provider,
  // so the meter costs one pass over an existing buffer and no extra graph nodes.
  // Genuinely free while the meter is off: no callback, no loop.
  private reportLevel(frame: Float32Array): void {
    const onLevel = this.opts.onLevel;
    if (!onLevel || !this.levelReporting) return;
    const now = performance.now();
    if (now - this.lastLevelAt < LEVEL_INTERVAL_MS) return;
    this.lastLevelAt = now;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    onLevel(frame.length ? Math.sqrt(sum / frame.length) : 0);
  }

  // --- D1: coach-turn capture for shadowing -------------------------------

  /** The coach started speaking — start a fresh capture.
   *
   *  This also DROPS the previous model. Once a new turn begins, the old clip is no
   *  longer 「教練剛才那句」, and handing it back would have the shadowing card
   *  confidently play the wrong sentence. */
  beginCoachTurn(): void {
    this.capturing = [];
    this.capturedLength = 0;
    this.lastTurn = null;
  }

  /** The coach finished cleanly — this turn becomes the shadowing model. Captured
   *  nothing (a turn cut short, or one whose audio never arrived)? Then there is no
   *  model, and `lastCoachTurn` stays null rather than resurrecting an older one. */
  endCoachTurn(): void {
    if (!this.capturing?.length) {
      this.capturing = null;
      return;
    }
    const samples = new Float32Array(this.capturedLength);
    let at = 0;
    for (const chunk of this.capturing) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    this.lastTurn = { samples, sampleRate: this.opts.outputSampleRate };
    this.capturing = null;
    this.capturedLength = 0;
  }

  /** Throw away the in-progress capture (barge-in cut the turn short). */
  discardCoachTurn(): void {
    this.capturing = null;
    this.capturedLength = 0;
  }

  /** The coach's most recent COMPLETE turn, or null if there isn't one yet. */
  lastCoachTurn(): CoachClip | null {
    return this.lastTurn;
  }

  /** Queue provider audio for gapless playback. */
  playPcm(pcm: ArrayBuffer): void {
    if (!this.ctx) return;
    const samples = pcm16ToFloat32(pcm);
    if (this.capturing) {
      const room = this.opts.outputSampleRate * MAX_TURN_SECONDS - this.capturedLength;
      if (room > 0) {
        const keep = samples.length <= room ? samples : samples.subarray(0, room);
        this.capturing.push(keep);
        this.capturedLength += keep.length;
      }
    }
    const buffer = this.ctx.createBuffer(1, samples.length, this.opts.outputSampleRate);
    // .set() avoids the TS 5.7 Float32Array<ArrayBuffer> generic mismatch that
    // copyToChannel's signature triggers.
    buffer.getChannelData(0).set(samples);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = this.rate;
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.playHead < now) this.playHead = now;
    node.start(this.playHead);
    // Wall-clock playback time scales with rate (<1 = longer), so advance the
    // gapless play-head by the real duration or chunks overlap in slow mode.
    this.playHead += buffer.duration / this.rate;
    this.scheduled.push(node);
    node.onended = () => {
      const i = this.scheduled.indexOf(node);
      if (i !== -1) this.scheduled.splice(i, 1);
    };
  }

  /** Drop any scheduled playback — used on barge-in ('interrupted' state). */
  flushPlayback(): void {
    // Whatever the coach was mid-way through saying was cut off, so it must not
    // become a shadowing model. Covers both callers: barge-in and pauseMic.
    this.discardCoachTurn();
    if (!this.ctx) return;
    for (const node of this.scheduled) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* node may have finished already */
      }
    }
    this.scheduled = [];
    this.playHead = this.ctx.currentTime;
  }

  /** Pause: stop the mic (light off) + silence playback, but keep the
   *  AudioContext and worklet so resume is cheap. The live session stays open. */
  pauseMic(): void {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.flushPlayback();
  }

  /** Resume after pauseMic: re-acquire the mic and re-wire it to the worklet.
   *  Must be called from a user gesture. */
  async resumeMic(): Promise<void> {
    if (!this.ctx || !this.workletNode) return;
    await this.ctx.resume();
    this.playHead = this.ctx.currentTime;
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.workletNode);
  }

  async stop(): Promise<void> {
    this.workletNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.scheduled = [];
    await this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.workletNode = null;
    this.source = null;
  }
}
