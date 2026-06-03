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

export interface AudioEngineOptions {
  inputSampleRate: number; // provider expects (e.g. 16000 for Gemini)
  outputSampleRate: number; // provider produces (e.g. 24000 for Gemini)
  onChunk: (pcm: ArrayBuffer) => void;
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
  private readonly opts: AudioEngineOptions;

  constructor(opts: AudioEngineOptions) {
    this.opts = opts;
  }

  /** Must be called from a user gesture (autoplay policy). */
  async start(): Promise<void> {
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.playHead = this.ctx.currentTime;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
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
    };
    this.source.connect(this.workletNode);
    // Worklet has no output we want audible; do not connect to destination.
  }

  /** Queue provider audio for gapless playback. */
  playPcm(pcm: ArrayBuffer): void {
    if (!this.ctx) return;
    const samples = pcm16ToFloat32(pcm);
    const buffer = this.ctx.createBuffer(1, samples.length, this.opts.outputSampleRate);
    // .set() avoids the TS 5.7 Float32Array<ArrayBuffer> generic mismatch that
    // copyToChannel's signature triggers.
    buffer.getChannelData(0).set(samples);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.playHead < now) this.playHead = now;
    node.start(this.playHead);
    this.playHead += buffer.duration;
    this.scheduled.push(node);
    node.onended = () => {
      const i = this.scheduled.indexOf(node);
      if (i !== -1) this.scheduled.splice(i, 1);
    };
  }

  /** Drop any scheduled playback — used on barge-in ('interrupted' state). */
  flushPlayback(): void {
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
