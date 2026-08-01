import { describe, expect, it } from "vitest";

import { encodeWav } from "./pcm";

describe("encodeWav — D1 wraps the coach's PCM so it can be replayed as media", () => {
  const ascii = (view: DataView, at: number, len: number) =>
    String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(at + i)));

  it("writes a valid 16-bit mono RIFF/WAVE header for the given rate", () => {
    const wav = encodeWav(new Float32Array(100), 24000);
    const v = new DataView(wav);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint16(20, true)).toBe(1); // uncompressed PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000); // byte rate = rate * 2
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("sizes the file and the data chunk to the sample count", () => {
    const wav = encodeWav(new Float32Array(64), 16000);
    const v = new DataView(wav);
    expect(wav.byteLength).toBe(44 + 128);
    expect(v.getUint32(4, true)).toBe(36 + 128); // RIFF size excludes the first 8 bytes
    expect(v.getUint32(40, true)).toBe(128);
  });

  it("carries the samples through as little-endian PCM16 after the header", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const v = new DataView(wav);
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(48, true)).toBe(-0x8000);
  });

  it("produces a header-only file for an empty turn rather than throwing", () => {
    expect(encodeWav(new Float32Array(0), 24000).byteLength).toBe(44);
  });
});

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
