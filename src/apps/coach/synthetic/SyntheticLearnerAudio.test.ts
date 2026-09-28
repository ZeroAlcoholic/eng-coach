import { describe, expect, it } from "vitest";

import type { AudioCallbacks } from "../session";
import { SyntheticLearnerAudio, type Clock } from "./SyntheticLearnerAudio";

// A clock the test drives by hand: timers fire in order when `advance` reaches them.
function fakeClock() {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
  const advance = (ms: number) => {
    const target = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = target;
  };
  return { clock, advance, pending: () => timers.size };
}

function harness() {
  const chunks: ArrayBuffer[] = [];
  let drained = 0;
  const callbacks: AudioCallbacks = { onChunk: (c) => chunks.push(c), onLevel: () => {}, onDrained: () => drained++ };
  const { clock, advance, pending } = fakeClock();
  const audio = new SyntheticLearnerAudio(callbacks, 24_000, clock);
  return { audio, chunks, drained: () => drained, advance, pending };
}

const pcm = (samples: number) => new ArrayBuffer(samples * 2);

describe("SyntheticLearnerAudio — the SessionAudio contract, on a clock", () => {
  it("start resolves at once; stop resolves at once, cancels pending speech and settles the awaited say()", async () => {
    const h = harness();
    await expect(h.audio.start()).resolves.toBeUndefined();
    const said = h.audio.say(pcm(320 * 5));
    expect(h.pending()).toBeGreaterThan(0);
    await expect(h.audio.stop()).resolves.toBeUndefined();
    expect(h.pending()).toBe(0);
    await expect(said).resolves.toBeUndefined();
  });

  it("playPcm accounts for the coach's audio by duration: isPlaying until it runs out, then onDrained once", () => {
    const h = harness();
    h.audio.playPcm(pcm(24_000)); // one second at 24 kHz
    expect(h.audio.isPlaying()).toBe(true);
    h.advance(999);
    expect(h.audio.isPlaying()).toBe(true);
    expect(h.drained()).toBe(0);
    h.advance(1);
    expect(h.audio.isPlaying()).toBe(false);
    expect(h.drained()).toBe(1);
  });

  it("chunks queue back to back, and a slower playback rate stretches them", () => {
    const h = harness();
    h.audio.setPlaybackRate(0.5);
    h.audio.playPcm(pcm(24_000));
    h.audio.playPcm(pcm(24_000));
    h.advance(3999);
    expect(h.audio.isPlaying()).toBe(true);
    h.advance(1);
    expect(h.audio.isPlaying()).toBe(false);
    expect(h.drained()).toBe(1);
  });

  it("flushPlayback silences at once and cancels the drain (a flush is not a drain)", () => {
    const h = harness();
    h.audio.playPcm(pcm(24_000));
    h.audio.flushPlayback();
    expect(h.audio.isPlaying()).toBe(false);
    h.advance(2000);
    expect(h.drained()).toBe(0);
  });

  it("pauseMic mutes what say() would send and flushes playback; resumeMic lets speech through again", async () => {
    const h = harness();
    await h.audio.start();
    h.audio.playPcm(pcm(24_000));
    h.audio.pauseMic();
    expect(h.audio.isPlaying()).toBe(false);
    const p = h.audio.say(pcm(320 * 2));
    h.advance(20 * 40);
    await p;
    expect(h.chunks).toHaveLength(0);
    await h.audio.resumeMic();
    const q = h.audio.say(pcm(320 * 2));
    h.advance(20 * 40);
    await q;
    expect(h.chunks.length).toBe(SyntheticLearnerAudio.framesFor(320 * 2 * 2));
  });

  it("say(): frames = ceil(bytes / 640) speech frames + 30 silence frames, each 640 bytes, 20 ms apart, resolving after the last", async () => {
    const h = harness();
    await h.audio.start();
    const bytes = 320 * 2 * 7 + 100; // seven full frames and a partial one
    const done = h.audio.say(new ArrayBuffer(bytes));
    let resolved = false;
    void done.then(() => (resolved = true));
    h.advance(20 * 7);
    expect(h.chunks).toHaveLength(8); // frames 0..7 fire at 0..140 ms
    h.advance(20 * 29);
    expect(h.chunks).toHaveLength(8 + 29);
    expect(resolved).toBe(false);
    h.advance(20);
    await done;
    expect(h.chunks).toHaveLength(8 + 30);
    expect(h.chunks.every((c) => c.byteLength === 640)).toBe(true);
    expect(SyntheticLearnerAudio.framesFor(bytes)).toBe(8 + 30);
  });

  it("say() before start (or after stop) rejects: a line that could not be sent is never reported as spoken", async () => {
    const h = harness();
    await expect(h.audio.say(pcm(320))).rejects.toThrow(/before start/);
    expect(h.chunks).toHaveLength(0);
  });

  it("beginCoachTurn / endCoachTurn / lastCoachTurn capture the turn's audio at the output rate", () => {
    const h = harness();
    expect(h.audio.lastCoachTurn()).toBeNull();
    h.audio.beginCoachTurn();
    h.audio.playPcm(pcm(100));
    h.audio.playPcm(pcm(50));
    h.audio.endCoachTurn();
    const clip = h.audio.lastCoachTurn();
    expect(clip).toMatchObject({ sampleRate: 24_000 });
    expect(clip?.samples).toHaveLength(150);
    // audio outside a turn is not captured; an empty turn yields no clip
    h.audio.beginCoachTurn();
    h.audio.endCoachTurn();
    expect(h.audio.lastCoachTurn()).toBeNull();
  });

  it("setLevelReporting is accepted and changes nothing observable", () => {
    const h = harness();
    h.audio.setLevelReporting();
    expect(h.audio.isPlaying()).toBe(false);
  });
});

describe("SyntheticLearnerAudio — idle silence, as a real microphone would stream it", () => {
  it("with idleSilence on, silence frames flow every 20 ms between utterances and stop at stop()", async () => {
    const chunks: ArrayBuffer[] = [];
    const { clock, advance } = fakeClock();
    const audio = new SyntheticLearnerAudio({ onChunk: (c) => chunks.push(c), onLevel: () => {}, onDrained: () => {} }, 24_000, clock, true);
    await audio.start();
    advance(100);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((c) => c.byteLength === 640)).toBe(true);
    const p = audio.say(pcm(320)); // one speech frame + 30 silence: idle frames pause meanwhile
    advance(20 * 31);
    await p;
    // 31 utterance frames (t=100…700); the idle stream is silent during them
    // and resumes the moment the utterance ends (its own frames at 700 and 720).
    expect(chunks).toHaveLength(5 + 31 + 2);
    await audio.stop();
    advance(1000);
    expect(chunks).toHaveLength(5 + 31 + 2);
  });
});
