import { describe, expect, it } from "vitest";

import { CHIME, scheduleChime } from "./chime";

function fakeCtx(state: AudioContextState) {
  const calls: string[] = [];
  const param = (name: string) => ({
    setValueAtTime: (v: number, at: number) => calls.push(`${name}.set ${v}@${at}`),
    linearRampToValueAtTime: (v: number, at: number) => calls.push(`${name}.ramp ${v}@${at}`),
  });
  const gainNode = { gain: param("gain"), connect: (d: unknown) => (calls.push("gain→dest"), d) };
  const osc = {
    type: "",
    frequency: param("freq"),
    connect: (g: unknown) => (calls.push("osc→gain"), g),
    start: (at: number) => calls.push(`start@${at}`),
    stop: (at: number) => calls.push(`stop@${at}`),
  };
  const ctx = {
    state,
    currentTime: 2,
    destination: {},
    createOscillator: () => osc,
    createGain: () => gainNode,
  } as unknown as BaseAudioContext;
  return { ctx, calls, osc };
}

describe("scheduleChime (C1)", () => {
  it("an 80 ms 880 Hz sine at gain 0.15, faded linearly to 0, starting now", () => {
    const { ctx, calls, osc } = fakeCtx("running");
    scheduleChime(ctx);
    expect(CHIME).toEqual({ hz: 880, gain: 0.15, seconds: 0.08 });
    expect(osc.type).toBe("sine");
    expect(calls).toEqual([
      "freq.set 880@2",
      "gain.set 0.15@2",
      "gain.ramp 0@2.08",
      "osc→gain",
      "gain→dest",
      "start@2",
      "stop@2.08",
    ]);
  });

  it("a suspended or closed context, or none, plays nothing and does not throw", () => {
    for (const state of ["suspended", "closed"] as const) {
      const { ctx, calls } = fakeCtx(state);
      expect(() => scheduleChime(ctx)).not.toThrow();
      expect(calls).toEqual([]);
    }
    expect(() => scheduleChime(null)).not.toThrow();
  });
});
