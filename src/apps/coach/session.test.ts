import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeminiDirectHandlers } from "../../api/gemini-direct";
import {
  AUTO_STOP_MS,
  NUDGES_SPENT_NOTICE,
  PracticeSession,
  type AudioCallbacks,
  type SessionAudio,
  type SessionDeps,
  type SessionListener,
  type SessionPhase,
  type SessionTransport,
  type TransportSpec,
} from "./session";
import { CLOSING_LINE } from "./prompt";

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
  texts: string[] = []; // stage directions (silence nudges)
  textReady = true; // false = socket not ready, sendText reports "not sent"
  constructor(public readonly handlers: GeminiDirectHandlers) {}
  connect(): Promise<void> {
    return this.connectGate.promise;
  }
  sendAudio(pcm: ArrayBuffer): void {
    this.sent.push(pcm);
  }
  sendText(text: string): boolean {
    if (!this.textReady) return false;
    this.texts.push(text);
    return true;
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
  chimes = 0;
  chime(): void {
    this.chimes++;
  }
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

function harness(silenceDelaysMs?: { first: number; next: number }, extra: Partial<SessionDeps> = {}) {
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
      ...(silenceDelaysMs ? { silenceDelaysMs } : {}),
      ...extra,
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
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: true, closing: false, autoStop: false });
    transport.handlers.onUserTranscript?.("still here");
    expect(h.listener.onTranscript).toHaveBeenCalledWith("user", "still here");
    transport.handlers.onResumed?.(true);
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false, closing: false, autoStop: false });
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
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: true, reconnecting: false, closing: false, autoStop: false });
    await h.session.resume();
    expect(transport.reconnects).toBe(1);
    expect(audio.resumed).toBe(1);
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false, closing: false, autoStop: false });
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
    expect(h.phases.at(-1)).toEqual({ kind: "live", paused: false, reconnecting: false, closing: false, autoStop: false });
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

// ── Silence nudges ─────────────────────────────────────────────────────
// The live model only replies to input: when the learner freezes on their turn
// the owner sends a stage direction so the coach takes the lead.
describe("PracticeSession — silence nudges", () => {
  const nudges = ["(n1)", "(n2)", "(n3)"];
  const nudgeSpec: TransportSpec = { ...spec, silenceNudges: nudges };
  const delays = { first: 100, next: 50 }; // fake-clock units; margins below are +10
  // Fake clock: the assertions are about ORDER on a timeline, not wall time.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  /** Coach turn that finishes with nothing left to play → cue "you". */
  function coachTurnEnds(transport: FakeTransport) {
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
  }

  it("is off when the spec carries no nudges", async () => {
    const h = harness(delays);
    const started = h.session.start(spec); // plain spec, no nudges
    const transport = h.transports.at(-1)!;
    transport.connectGate.resolve();
    await wait(0);
    h.audios.at(-1)!.startGate.resolve();
    await started;
    coachTurnEnds(transport);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
  });

  it("nudges on silence, escalates, and stops at the cap", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    coachTurnEnds(transport);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]);
    await wait(delays.next + 10);
    expect(transport.texts).toEqual(["(n1)", "(n2)"]);
    await wait(delays.next + 10);
    expect(transport.texts).toEqual(["(n1)", "(n2)", "(n3)"]);
    await wait(delays.next * 3);
    expect(transport.texts).toHaveLength(3); // MAX_SILENCE_NUDGES: the mic stays live, the coach waits
  });

  async function liveWithNudges(h: ReturnType<typeof harness>) {
    const started = h.session.start(nudgeSpec);
    const transport = h.transports.at(-1)!;
    transport.connectGate.resolve();
    await wait(0);
    const audio = h.audios.at(-1)!;
    audio.startGate.resolve();
    await started;
    return { transport, audio };
  }

  it("learner speech resets the clock and the escalation", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    coachTurnEnds(transport);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]);
    transport.handlers.onUserTranscript?.("hello"); // they spoke
    await wait(delays.next + 5);
    expect(transport.texts).toEqual(["(n1)"]); // the shorter "next" delay no longer applies…
    await wait(delays.first - delays.next + 10);
    expect(transport.texts).toEqual(["(n1)", "(n1)"]); // …a fresh streak starts from the first nudge
  });

  it("never nudges while the coach is talking, paused, or reconnecting", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.handlers.onTurnState?.("coach"); // coach is talking
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
    coachTurnEnds(transport);
    h.session.pause();
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
    await h.session.resume(); // resumed on the learner's turn → clock restarts
    transport.handlers.onReconnecting?.();
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
    transport.handlers.onResumed?.(true);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]);
  });

  it("a barge-in restarts the clock but keeps the streak (a GoAway hand-over also lands here)", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    coachTurnEnds(transport);
    await wait(delays.first - 5);
    transport.handlers.onInterrupted?.();
    await wait(10);
    expect(transport.texts).toEqual([]); // the clock restarted at the barge-in
    await wait(delays.first);
    expect(transport.texts).toEqual(["(n1)"]);
    // The coach replies to the nudge, then a hand-over cuts it off: no learner
    // speech happened, so the next nudge is the SECOND one, not a fresh first.
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onInterrupted?.();
    await wait(delays.next + 10);
    expect(transport.texts).toEqual(["(n1)", "(n2)"]);
  });

  it("resuming over a dropped socket mid-coach-turn hands the turn over and arms the clock", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.handlers.onTurnState?.("coach"); // coach mid-sentence
    h.session.pause();
    transport.open = false; // socket dropped while paused (phone slept)
    await h.session.resume();
    expect(transport.reconnects).toBe(1);
    expect(h.cues.at(-1)).toBe("you"); // not stuck on「教練說話中」
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]);
  });

  it("resuming over a still-open socket mid-coach-turn leaves the turn with the coach", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.handlers.onTurnState?.("coach");
    h.session.pause();
    await h.session.resume();
    expect(h.cues.at(-1)).toBe("coach");
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
  });

  it("waits (uncounted) while the mic is loud — the learner has started talking", async () => {
    const h = harness(delays);
    const { transport, audio } = await liveWithNudges(h);
    coachTurnEnds(transport);
    await wait(delays.first - 10);
    const loud = new Int16Array(160).fill(8000); // ~0.24 rms: speech
    audio.callbacks.onChunk(loud.buffer);
    await wait(20);
    expect(transport.texts).toEqual([]); // postponed, not fired
    await wait(1500 + 10); // VOICE_HOLD_MS later, still quiet since → fires as the FIRST nudge
    expect(transport.texts).toEqual(["(n1)"]);
    audio.callbacks.onChunk(new Int16Array(160).buffer); // silence never counts as voice
  });

  it("retries a nudge the socket could not take instead of dropping it", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.textReady = false; // resumed socket still completing setup
    coachTurnEnds(transport);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
    transport.textReady = true;
    await wait(2000 + 10); // SEND_RETRY_MS
    expect(transport.texts).toEqual(["(n1)"]); // still the FIRST nudge
  });

  it("opening watch: no coach turn at all after going live → hand over and nudge", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    expect(h.cues).toEqual(["coach"]);
    await wait(delays.first + 10);
    expect(h.cues.at(-1)).toBe("you");
    expect(transport.texts).toEqual(["(n1)"]);
  });

  it("opening watch is disarmed by the coach's first turn", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.handlers.onTurnState?.("coach");
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
  });

  it("stop clears the timer: nothing is sent after the session ended", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    coachTurnEnds(transport);
    await h.session.stop();
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
  });

  it("a nudge the socket could not take is not counted; retries stop after the cap", async () => {
    const h = harness(delays);
    const { transport } = await liveWithNudges(h);
    transport.textReady = false;
    coachTurnEnds(transport);
    await wait(delays.first + 10);
    expect(transport.texts).toEqual([]);
    await wait(2000 * 6); // past MAX_SEND_RETRIES × SEND_RETRY_MS
    transport.textReady = true;
    await wait(2000 * 2);
    expect(transport.texts).toEqual([]); // gave up; nothing fires on its own
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]); // still the FIRST nudge: the failed ones never counted
  });
});

describe("PracticeSession —「換你說」tone and buzz (C1)", () => {
  const withBuzz = () => {
    const vibrate = vi.fn();
    return { h: harness(undefined, { vibrate }), vibrate };
  };

  it("turnComplete with nothing playing: one chime and one 60 ms buzz", async () => {
    const { h, vibrate } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(60);
  });

  it("audio still playing: nothing until the drain, then exactly one", async () => {
    const { h, vibrate } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(0); // coach still audible
    audio.playing = false;
    audio.callbacks.onDrained();
    audio.callbacks.onDrained(); // a second drain is no second turn
    expect(audio.chimes).toBe(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("never while the coach is talking, on a barge-in, while paused, or while reconnecting", async () => {
    const { h, vibrate } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    expect(audio.chimes).toBe(0); // coach speaking
    transport.handlers.onInterrupted?.(); // barge-in: the learner is already talking
    expect(h.cues.at(-1)).toBe("you");
    expect(audio.chimes).toBe(0);

    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you"); // awaiting drain
    h.session.pause(); // pause hands the turn over itself
    expect(h.cues.at(-1)).toBe("you");
    expect(audio.chimes).toBe(0);
    await h.session.resume();

    transport.handlers.onTurnState?.("coach");
    transport.handlers.onReconnecting?.();
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("GoAway cuts the coach off: no tone during the hand-over, one when the resumed socket is up", async () => {
    const { h, vibrate } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onInterrupted?.(); // the transport's hand-over, same signal as a barge-in
    transport.handlers.onReconnecting?.();
    expect(audio.chimes).toBe(0);
    transport.handlers.onResumed?.(true);
    expect(audio.chimes).toBe(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("GoAway while the last audio drains: the drain mid-reconnect is held, paid on resume", async () => {
    const { h } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onTurnState?.("you"); // awaiting drain
    transport.handlers.onReconnecting?.();
    audio.playing = false;
    audio.callbacks.onDrained();
    expect(audio.chimes).toBe(0);
    transport.handlers.onResumed?.(true);
    expect(audio.chimes).toBe(1);
  });

  it("a real barge-in owes nothing: the learner's words cancel it before any resume", async () => {
    const { h } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onInterrupted?.();
    transport.handlers.onUserTranscript?.("Sorry, can I ask");
    transport.handlers.onReconnecting?.();
    transport.handlers.onResumed?.(true);
    expect(audio.chimes).toBe(0);
  });

  it("after the session ended: nothing", async () => {
    const { h } = withBuzz();
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    await h.session.stop();
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(0);
  });

  it("turned off (prefs.turnCue false): nothing; on again: back", async () => {
    const { h, vibrate } = withBuzz();
    h.session.setTurnCue(false);
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();
    h.session.setTurnCue(true);
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    expect(audio.chimes).toBe(1);
  });

  it("no vibrate API: the chime still plays and nothing throws", async () => {
    const h = harness(); // deps without vibrate
    const { transport, audio } = await goLive(h);
    transport.handlers.onTurnState?.("coach");
    expect(() => transport.handlers.onTurnState?.("you")).not.toThrow();
    expect(audio.chimes).toBe(1);
  });

  it("a throwing chime or buzz does not touch the session", async () => {
    const h = harness(undefined, {
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    const { transport, audio } = await goLive(h);
    audio.chime = () => {
      throw new Error("context closed");
    };
    transport.handlers.onTurnState?.("coach");
    expect(() => transport.handlers.onTurnState?.("you")).not.toThrow();
    expect(h.cues.at(-1)).toBe("you");
    expect(h.session.currentPhase().kind).toBe("live");
  });
});

describe("PracticeSession — the coach's closing line ends the session (C2)", () => {
  const nudges = ["(n1)", "(n2)", "(n3)"];
  const nudgeSpec: TransportSpec = { ...spec, silenceNudges: nudges };
  const delays = { first: 100, next: 50 };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  async function live() {
    const onAutoStop = vi.fn();
    const h = harness(delays);
    h.listener.onAutoStop = onAutoStop;
    const started = h.session.start(nudgeSpec);
    const transport = h.transports.at(-1)!;
    transport.connectGate.resolve();
    await wait(0);
    const audio = h.audios.at(-1)!;
    audio.startGate.resolve();
    await started;
    return { h, transport, audio, onAutoStop };
  }

  /** One coach turn saying `parts` as transcript deltas, ending with nothing left to play. */
  function coachSays(transport: FakeTransport, ...parts: string[]) {
    transport.handlers.onTurnState?.("coach");
    for (const p of parts) transport.handlers.onAssistantTranscript?.(p);
    transport.handlers.onTurnState?.("you");
  }

  it("closing line → no nudge ever, and the session asks to stop once, 15 s after the turn ends", async () => {
    const { h, transport, onAutoStop } = await live();
    coachSays(transport, "You got the window seat. 很好，你今天能說明需求了。", CLOSING_LINE, "。");
    expect(h.phases.at(-1)).toMatchObject({ kind: "live", closing: true });
    await wait(AUTO_STOP_MS - 10);
    expect(onAutoStop).not.toHaveBeenCalled();
    await wait(20);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    await wait(AUTO_STOP_MS * 2);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(transport.texts).toEqual([]); // not one nudge after the close
  });

  it("the line split across deltas, with spacing, or in Simplified form still counts", async () => {
    for (const parts of [["今天就", "練到這", "裡"], ["好，今天 就練到", " 這裡！"], ["今天就练到这里"]]) {
      const { transport, onAutoStop } = await live();
      coachSays(transport, ...parts);
      await wait(AUTO_STOP_MS + 10);
      expect(onAutoStop, parts.join("|")).toHaveBeenCalledTimes(1);
      expect(transport.texts).toEqual([]);
    }
  });

  it("no closing line → the nudges go out as before and nothing stops", async () => {
    const { transport, onAutoStop } = await live();
    coachSays(transport, "So, what would you like to order?");
    await wait(delays.first + 10);
    expect(transport.texts).toEqual(["(n1)"]);
    await wait(AUTO_STOP_MS * 2);
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it("the learner speaks after the close → no auto-stop, still no nudges (closing stays)", async () => {
    const { h, transport, onAutoStop } = await live();
    coachSays(transport, CLOSING_LINE);
    await wait(1000);
    transport.handlers.onUserTranscript?.("Thank you so much!");
    coachSays(transport, "You're welcome!");
    await wait(AUTO_STOP_MS * 3);
    expect(onAutoStop).not.toHaveBeenCalled();
    expect(transport.texts).toEqual([]);
    expect(h.phases.at(-1)).toMatchObject({ closing: true, autoStop: false });
  });

  it("the phase says the session will end itself only until the learner speaks", async () => {
    const { h, transport } = await live();
    coachSays(transport, CLOSING_LINE);
    expect(h.phases.at(-1)).toMatchObject({ closing: true, autoStop: true });
    transport.handlers.onUserTranscript?.("Thanks!");
    expect(h.phases.at(-1)).toMatchObject({ closing: true, autoStop: false });
  });

  it("voice on the mic as the countdown ends postpones it (a last word is not cut off)", async () => {
    const { transport, audio, onAutoStop } = await live();
    coachSays(transport, CLOSING_LINE);
    await wait(AUTO_STOP_MS - 100);
    const loud = new Int16Array(160).fill(16000).buffer;
    audio.callbacks.onChunk(loud);
    await wait(200);
    expect(onAutoStop).not.toHaveBeenCalled();
    await wait(5_000); // quiet again: the bounded postpones run out
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("transcript that arrives before the turn is announced still counts toward the line", async () => {
    const { transport, onAutoStop } = await live();
    coachSays(transport, "Here is your key.");
    // one server message: its transcript is delivered before setTurn("coach")
    transport.handlers.onAssistantTranscript?.("Enjoy your stay. 今天就");
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAssistantTranscript?.("練到這裡。");
    transport.handlers.onTurnState?.("you");
    await wait(AUTO_STOP_MS + 10);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("paused → no auto-stop however long; resumed → the countdown starts again", async () => {
    const { h, transport, onAutoStop } = await live();
    coachSays(transport, CLOSING_LINE);
    await wait(1000);
    h.session.pause();
    await wait(AUTO_STOP_MS * 3);
    expect(onAutoStop).not.toHaveBeenCalled();
    await h.session.resume();
    await wait(AUTO_STOP_MS + 10);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("the countdown starts only when the closing turn has finished playing", async () => {
    const { transport, audio, onAutoStop } = await live();
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAudio(new ArrayBuffer(4));
    transport.handlers.onAssistantTranscript?.(CLOSING_LINE);
    transport.handlers.onTurnState?.("you"); // audio still playing
    await wait(AUTO_STOP_MS * 2);
    expect(onAutoStop).not.toHaveBeenCalled();
    audio.playing = false;
    audio.callbacks.onDrained();
    await wait(AUTO_STOP_MS + 10);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("no turn tone after the close (C1)", async () => {
    const { transport, audio } = await live();
    coachSays(transport, CLOSING_LINE);
    expect(audio.chimes).toBe(0);
  });

  it("a new session starts open again", async () => {
    const { h, transport } = await live();
    coachSays(transport, CLOSING_LINE);
    await h.session.stop();
    const started = h.session.start(nudgeSpec);
    h.transports.at(-1)!.connectGate.resolve();
    await wait(0);
    h.audios.at(-1)!.startGate.resolve();
    await started;
    expect(h.phases.at(-1)).toMatchObject({ kind: "live", closing: false, autoStop: false });
  });
});

describe("PracticeSession — after the last nudge, tell the learner what to do (C3)", () => {
  const nudgeSpec: TransportSpec = { ...spec, silenceNudges: ["(n1)", "(n2)", "(n3)"] };
  const delays = { first: 100, next: 50 };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  async function spentBudget() {
    const h = harness(delays);
    const started = h.session.start(nudgeSpec);
    const transport = h.transports.at(-1)!;
    transport.connectGate.resolve();
    await wait(0);
    h.audios.at(-1)!.startGate.resolve();
    await started;
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onTurnState?.("you");
    await wait(delays.first + delays.next * 2 + 30); // three nudges, unanswered
    expect(transport.texts).toEqual(["(n1)", "(n2)", "(n3)"]);
    const notices = () => vi.mocked(h.listener.onNotice).mock.calls.map((c) => c[0]);
    return { h, transport, notices };
  }

  it("one more silence after the third nudge → the notice once, never repeated", async () => {
    const { notices } = await spentBudget();
    expect(notices()).toEqual([]);
    await wait(delays.next + 10);
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE]);
    await wait(delays.next * 20);
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE]);
  });

  it("the learner speaks → the notice is withdrawn", async () => {
    const { transport, notices } = await spentBudget();
    await wait(delays.next + 10);
    transport.handlers.onUserTranscript?.("Sorry, I was thinking.");
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE, ""]);
  });

  it("paused, or the coach talks again, before the silence runs out → no notice", async () => {
    const a = await spentBudget();
    a.h.session.pause();
    await wait(delays.next * 4);
    expect(a.notices()).toEqual([]);

    const b = await spentBudget();
    b.transport.handlers.onTurnState?.("coach");
    await wait(delays.next * 4);
    expect(b.notices()).toEqual([]);
  });

  it("the coach answers the third nudge, then silence → the notice", async () => {
    const { transport, notices } = await spentBudget();
    transport.handlers.onTurnState?.("coach");
    await wait(delays.next * 4);
    expect(notices()).toEqual([]);
    transport.handlers.onTurnState?.("you");
    await wait(delays.next + 10);
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE]);
  });

  it("pause withdraws it; a new silence after resume earns it once more", async () => {
    const { h, notices } = await spentBudget();
    await wait(delays.next + 10);
    h.session.pause();
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE, ""]);
    await h.session.resume();
    await wait(delays.next + 10);
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE, "", NUDGES_SPENT_NOTICE]);
    await wait(delays.next * 10);
    expect(notices()).toHaveLength(3);
  });

  it("stop withdraws it", async () => {
    const { h, notices } = await spentBudget();
    await wait(delays.next + 10);
    await h.session.stop();
    expect(notices()).toEqual([NUDGES_SPENT_NOTICE, ""]);
  });

  it("the coach's closing line before the silence runs out → no notice", async () => {
    const { transport, notices } = await spentBudget();
    transport.handlers.onTurnState?.("coach");
    transport.handlers.onAssistantTranscript?.(CLOSING_LINE);
    transport.handlers.onTurnState?.("you");
    await wait(delays.next * 10);
    expect(notices()).toEqual([]);
  });

  it("a new session starts with the notice unspent", async () => {
    const { h, notices } = await spentBudget();
    await wait(delays.next + 10);
    await h.session.stop();
    const started = h.session.start(nudgeSpec);
    const t2 = h.transports.at(-1)!;
    t2.connectGate.resolve();
    await wait(0);
    h.audios.at(-1)!.startGate.resolve();
    await started;
    t2.handlers.onTurnState?.("coach");
    t2.handlers.onTurnState?.("you");
    await wait(delays.first + delays.next * 3 + 40);
    expect(t2.texts).toEqual(["(n1)", "(n2)", "(n3)"]);
    expect(notices().filter((n) => n === NUDGES_SPENT_NOTICE)).toHaveLength(2);
  });

  it("speaking resets the budget: the next silence nudges again before any notice", async () => {
    const { transport, notices } = await spentBudget();
    transport.handlers.onUserTranscript?.("OK");
    await wait(delays.first + 10);
    expect(transport.texts.at(-1)).toBe("(n1)");
    expect(notices()).toEqual([]);
  });
});
