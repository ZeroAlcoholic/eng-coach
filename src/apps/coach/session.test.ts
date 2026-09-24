import { describe, expect, it, vi } from "vitest";

import type { GeminiDirectHandlers } from "../../api/gemini-direct";
import {
  PracticeSession,
  type AudioCallbacks,
  type SessionAudio,
  type SessionListener,
  type SessionPhase,
  type SessionTransport,
  type TransportSpec,
} from "./session";

// Stand-ins at the two injection boundaries (transport, audio). They decide
// nothing: each await is a promise the test resolves or rejects by hand, so the
// test controls exactly where Stop / unmount / denial lands.
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeTransport implements SessionTransport {
  readonly connectGate = deferred();
  closed = 0;
  reconnects = 0;
  open = true;
  sent: ArrayBuffer[] = [];
  constructor(public readonly handlers: GeminiDirectHandlers) {}
  connect(): Promise<void> {
    return this.connectGate.promise;
  }
  sendAudio(pcm: ArrayBuffer): void {
    this.sent.push(pcm);
  }
  isOpen(): boolean {
    return this.open;
  }
  reconnect(): Promise<void> {
    this.reconnects++;
    this.open = true;
    return Promise.resolve();
  }
  close(): void {
    this.closed++;
    this.open = false;
  }
}

class FakeAudio implements SessionAudio {
  readonly startGate = deferred();
  stopped = 0;
  playing = false;
  played: ArrayBuffer[] = [];
  flushes = 0;
  paused = 0;
  resumed = 0;
  rate = 1;
  turns: string[] = [];
  constructor(public readonly callbacks: AudioCallbacks) {}
  start(): Promise<void> {
    return this.startGate.promise;
  }
  stop(): Promise<void> {
    this.stopped++;
    this.playing = false;
    return Promise.resolve();
  }
  playPcm(pcm: ArrayBuffer): void {
    this.played.push(pcm);
    this.playing = true;
  }
  flushPlayback(): void {
    this.flushes++;
    this.playing = false;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  pauseMic(): void {
    this.paused++;
  }
  resumeMic(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }
  setLevelReporting(): void {}
  beginCoachTurn(): void {
    this.turns.push("begin");
  }
  endCoachTurn(): void {
    this.turns.push("end");
  }
  lastCoachTurn() {
    return null;
  }
}

function harness() {
  const transports: FakeTransport[] = [];
  const audios: FakeAudio[] = [];
  const phases: SessionPhase[] = [];
  const cues: string[] = [];
  const listener: SessionListener = {
    onPhase: (p) => phases.push(p),
    onCue: (t) => cues.push(t),
    onTranscript: vi.fn(),
    onCoachClip: vi.fn(),
    onNotice: vi.fn(),
  };
  const wakeLock = { request: vi.fn(() => Promise.resolve({ release: () => Promise.resolve() } as WakeLockSentinel)) };
  const session = new PracticeSession(
    {
      createTransport: (_spec, handlers) => {
        const t = new FakeTransport(handlers);
        transports.push(t);
        return t;
      },
      createAudio: (callbacks) => {
        const a = new FakeAudio(callbacks);
        audios.push(a);
        return a;
      },
      wakeLock,
    },
    listener,
  );
  const kinds = () => phases.map((p) => (p.kind === "ended" ? `ended:${p.by}` : p.kind));
  return { session, transports, audios, phases, kinds, cues, listener, wakeLock };
}

const spec: TransportSpec = { apiKey: "unused", model: "m", systemInstruction: "s" };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Drive a session all the way to live. */
async function goLive(h: ReturnType<typeof harness>) {
  const started = h.session.start(spec);
  const transport = h.transports.at(-1)!;
  transport.connectGate.resolve();
  await tick();
  const audio = h.audios.at(-1)!;
  audio.startGate.resolve();
  await started;
  return { transport, audio };
}

describe("PracticeSession — start order", () => {
  it("is not「練習中」until the mic is ready: connecting → awaiting-mic → live", async () => {
    const h = harness();
    const started = h.session.start(spec);
    expect(h.kinds()).toEqual(["connecting"]);
    h.transports[0].connectGate.resolve();
    await tick();
    expect(h.kinds()).toEqual(["connecting", "awaiting-mic"]);
    expect(h.audios).toHaveLength(1);
    h.audios[0].startGate.resolve();
    await started;
    expect(h.kinds()).toEqual(["connecting", "awaiting-mic", "live"]);
    expect(h.cues).toEqual(["coach"]);
    expect(h.wakeLock.request).toHaveBeenCalledWith("screen");
  });

  it("applies the remembered playback rate to the engine the moment it exists", async () => {
    const h = harness();
    h.session.setPlaybackRate(0.85);
    const { audio } = await goLive(h);
    expect(audio.rate).toBe(0.85);
  });
});

describe("PracticeSession — Stop / unmount overtakes start", () => {
  it("Stop during connect: socket closed when it arrives, mic never requested", async () => {
    const h = harness();
    const started = h.session.start(spec);
    const stopped = h.session.stop();
    await stopped;
    expect(h.kinds()).toEqual(["connecting", "stopping", "ended:user"]);
    h.transports[0].connectGate.resolve(); // the connect now completes, too late
    await started;
    expect(h.transports[0].closed).toBe(1); // stop() closed it; the late connect adds nothing
    expect(h.audios).toHaveLength(0);
    expect(h.kinds().at(-1)).toBe("ended:user"); // never flipped to awaiting-mic/live
  });

  it("Stop during getUserMedia: the engine is stopped and live never appears", async () => {
    const h = harness();
    const started = h.session.start(spec);
    h.transports[0].connectGate.resolve();
    await tick();
    expect(h.kinds().at(-1)).toBe("awaiting-mic");
    await h.session.stop();
    h.audios[0].startGate.resolve(); // permission granted after the learner left
    await started;
    expect(h.audios[0].stopped).toBe(1);
    expect(h.transports[0].closed).toBe(1);
    expect(h.kinds()).toEqual(["connecting", "awaiting-mic", "stopping", "ended:user"]);
  });

  it("mic denied: everything acquired so far is released, phase says why", async () => {
    const h = harness();
    const started = h.session.start(spec);
    h.transports[0].connectGate.resolve();
    await tick();
    const denied = new Error("NotAllowedError: Permission denied");
    h.audios[0].startGate.reject(denied);
    await started;
    expect(h.transports[0].closed).toBe(1);
    expect(h.audios[0].stopped).toBe(1);
    const last = h.phases.at(-1);
    expect(last).toEqual({ kind: "ended", by: "start-failed", reason: denied });
  });

  it("connect failure: no engine is created, phase says start-failed", async () => {
    const h = harness();
    const started = h.session.start(spec);
    h.transports[0].connectGate.reject(new Error("bad key"));
    await started;
    expect(h.audios).toHaveLength(0);
    expect(h.kinds().at(-1)).toBe("ended:start-failed");
  });

  it("stop() is idempotent and start() ignores re-entry while a session exists", async () => {
    const h = harness();
    await goLive(h);
    await h.session.start(spec); // ignored
    expect(h.transports).toHaveLength(1);
    await h.session.stop();
    await h.session.stop();
    expect(h.transports[0].closed).toBe(1);
    expect(h.audios[0].stopped).toBe(1);
  });
});

describe("PracticeSession — a superseded session cannot touch the new one", () => {
  it("old transport callbacks after Stop → start are dropped", async () => {
    const h = harness();
    const first = await goLive(h);
    await h.session.stop();
    await goLive(h);
    expect(h.transports).toHaveLength(2);
    const before = h.phases.length;
    first.transport.handlers.onClose?.("aborted");
    first.transport.handlers.onUserTranscript?.("ghost");
    first.transport.handlers.onTurnState?.("coach");
    first.transport.handlers.onAudio(new ArrayBuffer(2));
    await tick();
    expect(h.phases.length).toBe(before);
    expect(h.kinds().at(-1)).toBe("live");
    expect(h.listener.onTranscript).not.toHaveBeenCalled();
    expect(h.audios[1].played).toHaveLength(0);
  });

  it("old engine chunks after Stop are not sent on the new socket", async () => {
    const h = harness();
    const first = await goLive(h);
    await h.session.stop();
    await goLive(h);
    first.audio.callbacks.onChunk(new ArrayBuffer(2));
    expect(h.transports[1].sent).toHaveLength(0);
  });
});

describe("PracticeSession —「換你說」waits for the loudspeaker, not the protocol", () => {
  it("turnComplete while audio is still playing: cue stays coach until drained", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4)); // last chunk, same packet as turnComplete
    transport.handlers.onTurnState?.("you");
    expect(audio.playing).toBe(true);
    expect(h.cues).toEqual(["coach"]);
    audio.playing = false;
    audio.callbacks.onDrained();
    expect(h.cues).toEqual(["coach", "you"]);
    expect(audio.turns).toEqual(["begin", "end"]);
  });

  it("turnComplete with nothing left to play: cue flips at once", async () => {
    const h = harness();
    const { transport } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    expect(h.cues).toEqual(["coach", "you"]);
  });

  it("a drain that arrives mid-turn (network slower than playback) is not a cue", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    audio.playing = false;
    audio.callbacks.onDrained(); // queue ran dry, but the turn is not over
    expect(h.cues).toEqual(["coach"]);
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you");
    audio.playing = false;
    audio.callbacks.onDrained();
    expect(h.cues).toEqual(["coach", "you"]);
  });

  it("barge-in: flush and hand over immediately, even with audio queued", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onInterrupted?.();
    expect(audio.flushes).toBe(1);
    expect(h.cues).toEqual(["coach", "you"]);
    // the protocol's own "you" that follows an interrupt adds nothing
    transport.handlers.onTurnState?.("you");
    expect(h.cues).toEqual(["coach", "you"]);
  });

  it("a stale drain from before a new coach turn cannot end that turn early", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you"); // awaiting drain
    transport.handlers.onTurnState?.("coach"); // model starts the next turn first
    audio.callbacks.onDrained(); // previous turn's last node ends now
    expect(h.cues).toEqual(["coach"]); // still the coach's turn
  });
});

describe("PracticeSession — connection lifecycle", () => {
  it("GoAway hand-over is a live sub-state, not an ending; transcript keeps flowing", async () => {
    const h = harness();
    const { transport } = await goLive(h);
    transport.handlers.onReconnecting?.();
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: true });
    transport.handlers.onUserTranscript?.("still here");
    expect(h.listener.onTranscript).toHaveBeenCalledWith("user", "still here");
    transport.handlers.onResumed?.(true);
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false });
    expect(h.listener.onNotice).not.toHaveBeenCalled();
    expect(transport.closed).toBe(0);
  });

  it("a hand-over without a handle warns that the coach may have forgotten", async () => {
    const h = harness();
    const { transport } = await goLive(h);
    transport.handlers.onReconnecting?.();
    transport.handlers.onResumed?.(false);
    expect(h.listener.onNotice).toHaveBeenCalledTimes(1);
  });

  it("a real drop releases the devices and ends with the reason", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onClose?.("quota exceeded");
    await tick();
    expect(audio.stopped).toBe(1);
    expect(h.phases.at(-1)).toEqual({ kind: "ended", by: "connection", reason: "quota exceeded" });
    expect(h.session.currentPhase().kind).toBe("ended");
  });

  it("a failed GoAway hand-over (not paused) releases the devices and ends with the reason", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onReconnecting?.();
    transport.handlers.onClose?.("resume refused");
    await tick();
    expect(h.phases.at(-1)).toEqual({ kind: "ended", by: "connection", reason: "resume refused" });
    expect(audio.stopped).toBe(1);
    expect(transport.closed).toBe(1);
  });

  it("a socket closed before live (setup rejected) is a failed start, not a dropped conversation", async () => {
    const h = harness();
    const started = h.session.start(spec);
    h.transports[0].connectGate.resolve();
    await tick();
    h.transports[0].handlers.onClose?.("");
    await tick();
    h.audios[0].startGate.resolve(); // the mic prompt is answered after the fact
    await started;
    expect(h.kinds()).toEqual(["connecting", "awaiting-mic", "ended:start-failed"]);
    expect(h.audios[0].stopped).toBe(1);
    expect(h.transports[0].closed).toBe(1);
  });

  it("a teardown error cannot wedge the session: the terminal phase still arrives", async () => {
    const h = harness();
    const { audio } = await goLive(h);
    audio.stop = () => {
      audio.stopped++;
      return Promise.reject(new Error("InvalidStateError: close failed"));
    };
    await h.session.stop();
    expect(h.kinds().at(-1)).toBe("ended:user");
    expect(h.listener.onNotice).toHaveBeenCalledTimes(1);
  });

  it("a drop while paused keeps the session; resume reconnects through the handle", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    h.session.pause();
    expect(audio.paused).toBe(1);
    transport.open = false;
    transport.handlers.onClose?.("idle timeout");
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: true, reconnecting: false });
    await h.session.resume();
    expect(transport.reconnects).toBe(1);
    expect(audio.resumed).toBe(1);
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false });
  });

  it("pausing while the finished turn is still playing hands over: no stuck 教練說話中 after resume", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you"); // awaiting drain
    h.session.pause(); // the real engine flushes playback here, and a flush is not a drain
    expect(audio.paused).toBe(1);
    expect(h.cues).toEqual(["coach", "you"]);
  });

  it("a failed GoAway hand-over while paused does not leave「重新連線中…」on forever", async () => {
    const h = harness();
    const { transport } = await goLive(h);
    h.session.pause();
    transport.handlers.onReconnecting?.();
    transport.open = false;
    transport.handlers.onClose?.("resume refused");
    await h.session.resume();
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false });
  });

  it("a drop and a Stop in the same window produce one ended phase, not two", async () => {
    const h = harness();
    const { transport } = await goLive(h);
    transport.handlers.onClose?.("aborted");
    await h.session.stop(); // lands while release() from the drop is in flight
    await tick();
    expect(h.kinds().filter((k) => k.startsWith("ended"))).toHaveLength(1);
  });

  it("a wake lock granted after the session was released is let go again", async () => {
    const h = harness();
    let grant!: (s: WakeLockSentinel) => void;
    const release = vi.fn(() => Promise.resolve());
    h.wakeLock.request.mockImplementationOnce(() => new Promise((r) => (grant = r)));
    const started = h.session.start(spec);
    await h.session.stop();
    grant({ release } as unknown as WakeLockSentinel);
    await tick();
    h.transports[0].connectGate.resolve();
    await started;
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a double tap on ▶ 接續 opens the mic once", async () => {
    const h = harness();
    const { audio } = await goLive(h);
    h.session.pause();
    await Promise.all([h.session.resume(), h.session.resume()]);
    expect(audio.resumed).toBe(1);
  });

  it("audio arriving while paused is dropped", async () => {
    const h = harness();
    const { transport, audio } = await goLive(h);
    h.session.pause();
    transport.handlers.onAudio(new ArrayBuffer(4));
    expect(audio.played).toHaveLength(0);
  });
});
