import { describe, expect, it } from "vitest";

import { float32ToPcm16, pcm16ToFloat32, resampleLinear } from "./pcm";

describe("pcm helpers", () => {
  it("round-trips float32 <-> pcm16 within quantization error", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const round = pcm16ToFloat32(float32ToPcm16(input));
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(round[i] - input[i])).toBeLessThan(0.001);
    }
  });

  it("clamps out-of-range samples", () => {
    const pcm = new DataView(float32ToPcm16(new Float32Array([2, -2])));
    expect(pcm.getInt16(0, true)).toBe(0x7fff);
    expect(pcm.getInt16(2, true)).toBe(-0x8000);
  });

  it("resamples 48k -> 16k by a factor of 3 in length", () => {
    const input = new Float32Array(48);
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(16);
  });

  it("passes through when rates match", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });
});
