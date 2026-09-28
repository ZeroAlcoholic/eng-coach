import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { armMicroCutoff, MICRO_CUTOFF_MS } from "./microCutoff";
import { PracticeSession, type SessionAudio, type SessionPhase, type SessionTransport } from "./session";

// Minimal stand-ins: the session goes live at once; the test only needs the
// phase stream to show whether Stop was driven by the clock.
const transport: SessionTransport = {
  connect: () => Promise.resolve(),
  sendAudio: () => {},
  isOpen: () => true,
  reconnect: () => Promise.resolve(),
  close: () => {},
};
const audio: SessionAudio = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  playPcm: () => {},
  flushPlayback: () => {},
  isPlaying: () => false,
  pauseMic: () => {},
  resumeMic: () => Promise.resolve(),
  setPlaybackRate: () => {},
  setLevelReporting: () => {},
  beginCoachTurn: () => {},
  endCoachTurn: () => {},
  lastCoachTurn: () => null,
};

async function liveSession() {
  const phases: SessionPhase["kind"][] = [];
  const session = new PracticeSession(
    { createTransport: () => transport, createAudio: () => audio },
    { onPhase: (p) => phases.push(p.kind), onCue: () => {}, onTranscript: () => {}, onCoachClip: () => {}, onNotice: () => {} },
  );
  await session.start({ apiKey: "unused", model: "m", systemInstruction: "s" });
  expect(phases.at(-1)).toBe("live");
  return { session, phases };
}

describe("armMicroCutoff — the micro session's hard stop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a micro session is stopped through the session's own Stop after 120 seconds", async () => {
    const { session, phases } = await liveSession();
    const after = vi.fn();
    armMicroCutoff(true, session, after);
    await vi.advanceTimersByTimeAsync(MICRO_CUTOFF_MS - 1);
    expect(phases).not.toContain("stopping");
    await vi.advanceTimersByTimeAsync(1);
    expect(phases).toContain("stopping");
    expect(phases.at(-1)).toBe("ended");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("a full session has no timer: nothing happens however long it runs", async () => {
    const { session, phases } = await liveSession();
    const after = vi.fn();
    armMicroCutoff(false, session, after);
    await vi.advanceTimersByTimeAsync(MICRO_CUTOFF_MS * 10);
    expect(phases.at(-1)).toBe("live");
    expect(after).not.toHaveBeenCalled();
  });

  it("disarming before the deadline cancels the stop (the learner stopped first)", async () => {
    const { session, phases } = await liveSession();
    const disarm = armMicroCutoff(true, session, () => {});
    disarm();
    await vi.advanceTimersByTimeAsync(MICRO_CUTOFF_MS * 2);
    expect(phases.at(-1)).toBe("live");
  });
});
