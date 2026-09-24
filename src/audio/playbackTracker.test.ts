import { describe, expect, it, vi } from "vitest";

import { PlaybackTracker } from "./playbackTracker";

describe("PlaybackTracker — when has the coach actually finished speaking", () => {
  it("drains only when the LAST scheduled node ends, not when the first does", () => {
    const onDrained = vi.fn();
    const t = new PlaybackTracker<string>(onDrained);
    t.scheduled("a");
    t.scheduled("b");
    t.scheduled("c");
    t.ended("a");
    t.ended("b");
    expect(onDrained).not.toHaveBeenCalled();
    expect(t.isPlaying()).toBe(true);
    t.ended("c");
    expect(onDrained).toHaveBeenCalledTimes(1);
    expect(t.isPlaying()).toBe(false);
  });

  it("a long sentence arriving chunk by chunk drains once, after the final chunk", () => {
    const onDrained = vi.fn();
    const t = new PlaybackTracker<number>(onDrained);
    // chunks arrive faster than they play: 1 ends after 2 and 3 were queued
    t.scheduled(1);
    t.scheduled(2);
    t.ended(1);
    t.scheduled(3);
    t.ended(2);
    expect(onDrained).not.toHaveBeenCalled();
    t.ended(3);
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  it("flush (barge-in / pause) is not a drain: no event, nodes handed back for silencing", () => {
    const onDrained = vi.fn();
    const t = new PlaybackTracker<string>(onDrained);
    t.scheduled("a");
    t.scheduled("b");
    expect(t.flush().sort()).toEqual(["a", "b"]);
    expect(onDrained).not.toHaveBeenCalled();
    expect(t.isPlaying()).toBe(false);
    // a late `ended` from a flushed node is ignored (not a spurious drain)
    t.ended("a");
    expect(onDrained).not.toHaveBeenCalled();
  });

  it("an unknown node ending never fires a drain", () => {
    const onDrained = vi.fn();
    const t = new PlaybackTracker<string>(onDrained);
    t.ended("ghost");
    expect(onDrained).not.toHaveBeenCalled();
  });
});
