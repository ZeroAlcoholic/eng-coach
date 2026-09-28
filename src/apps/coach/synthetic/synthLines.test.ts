import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { describeEstimate, diskStore, ensureLines, keyOf, MAX_LINES_PER_RUN, type Synthesiser } from "./synthLines";

// A synthesiser that counts calls and returns one second of 24 kHz silence.
function counting() {
  let calls = 0;
  const tts: Synthesiser = async () => {
    calls++;
    return { pcm: new ArrayBuffer(24_000 * 2), sampleRate: 24_000 };
  };
  return { tts, calls: () => calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "synth-"));
  dirs.push(d);
  return d;
}

describe("ensureLines — synthesise once, then never again", () => {
  it("first run calls once per unique line, resamples to 16 kHz, and writes <sha256>.pcm files that carry no text", async () => {
    const dir = tempDir();
    const { tts, calls } = counting();
    const texts = ["I want to book a table", "I want to book a table", "  ", "すみません"];
    const out = await ensureLines(texts, tts, diskStore(dir));
    expect(calls()).toBe(2);
    expect(out.synthesised).toBe(2);
    expect(out.lines.get("I want to book a table")?.byteLength).toBe(16_000 * 2);
    const files = readdirSync(dir);
    expect(files.sort()).toEqual([`${keyOf("I want to book a table")}.pcm`, `${keyOf("すみません")}.pcm`].sort());
    expect(files.every((f) => /^[0-9a-f]{64}\.pcm$/.test(f))).toBe(true);
  });

  it("second run over the same lines makes zero calls and returns the cached audio", async () => {
    const dir = tempDir();
    const { tts, calls } = counting();
    await ensureLines(["hello there"], tts, diskStore(dir));
    const again = await ensureLines(["hello there"], tts, diskStore(dir));
    expect(calls()).toBe(1);
    expect(again.synthesised).toBe(0);
    expect(again.lines.get("hello there")?.byteLength).toBe(16_000 * 2);
  });

  it("refuses to synthesise more than the per-run cap, before making any call", async () => {
    const dir = tempDir();
    const { tts, calls } = counting();
    const many = Array.from({ length: MAX_LINES_PER_RUN + 1 }, (_, i) => `line ${i}`);
    await expect(ensureLines(many, tts, diskStore(dir))).rejects.toThrow(/cap/);
    expect(calls()).toBe(0);
  });

  it("the estimate names the model, the line count and a cost bound", () => {
    const text = describeEstimate(["I want to book a table", "すみません"]);
    expect(text).toContain("gemini-3.8-flash-lite-tts");
    expect(text).toContain("2 句");
    expect(text).toMatch(/USD \d+\.\d{3}/);
  });
});

describe("decodeAudio — what the TTS model may answer with", () => {
  it("reads a WAV container's rate and data chunk; raw L16 comes from the mime type", async () => {
    const { decodeAudio } = await import("./synthLines");
    const { encodeWav } = await import("../../../audio/pcm");
    const samples = new Float32Array(2400).fill(0.25);
    const wav = encodeWav(samples, 24_000);
    const out = decodeAudio("audio/wav", wav);
    expect(out.sampleRate).toBe(24_000);
    expect(out.pcm.byteLength).toBe(4800);
    // the container is recognised by its bytes even under a vague mime type
    expect(decodeAudio("application/octet-stream", wav).sampleRate).toBe(24_000);
    const raw = decodeAudio("audio/L16;codec=pcm;rate=24000", new ArrayBuffer(100));
    expect(raw).toEqual({ pcm: new ArrayBuffer(100), sampleRate: 24_000 });
    expect(() => decodeAudio("audio/mpeg", new ArrayBuffer(100))).toThrow(/unexpected mime/);
  });

  it("refuses a truncated or empty data chunk instead of caching a stub line", async () => {
    const { decodeWav } = await import("./synthLines");
    const { encodeWav } = await import("../../../audio/pcm");
    const wav = encodeWav(new Float32Array(2400), 24_000);
    expect(() => decodeWav(wav.slice(0, 60))).toThrow(/truncated/);
    expect(() => decodeWav(encodeWav(new Float32Array(0), 24_000))).toThrow(/empty/);
  });

  it("an empty cache file counts as a miss", async () => {
    const { writeFileSync } = await import("node:fs");
    const dir = tempDir();
    writeFileSync(join(dir, `${keyOf("x y")}.pcm`), "");
    const { tts, calls } = counting();
    await ensureLines(["x y"], tts, diskStore(dir));
    expect(calls()).toBe(1);
  });
});
