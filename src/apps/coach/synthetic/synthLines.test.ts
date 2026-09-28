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
