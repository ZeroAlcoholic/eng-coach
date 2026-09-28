// F2 — the scripted learner's lines, synthesised ONCE and cached on disk.
//
// Text in, 16 kHz PCM16 out. Every line is keyed by the SHA-256 of its text,
// so the cache holds no text (nothing to leak, nothing to grep) and a second
// run over the same lines makes zero calls. The synthesiser is injected: the
// unit test hands in a counter, the paid run hands in the TTS model. The only
// model this file will ever ask for is the cheapest one that produces speech a
// recogniser can follow — it is a learner's voice, not a product's.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { float32ToPcm16, pcm16ToFloat32, resampleLinear } from "../../../audio/pcm";

export const TTS_MODEL = "gemini-3.8-flash-lite-tts";
export const CACHE_DIR = ".synthetic-cache";
export const MAX_LINES_PER_RUN = 60; // the hard cap the GOAL sets; asserted by the caller too
const TARGET_RATE = 16_000;

/** What the synthesiser returns: raw PCM16 mono and the rate it came at. */
export interface Synthesised {
  pcm: ArrayBuffer;
  sampleRate: number;
}

export type Synthesiser = (text: string) => Promise<Synthesised>;

export interface LineStore {
  read: (key: string) => Promise<ArrayBuffer | null>;
  write: (key: string, pcm: ArrayBuffer) => Promise<void>;
}

export const keyOf = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Disk store under `.synthetic-cache/<sha256>.pcm`. */
export function diskStore(dir = CACHE_DIR): LineStore {
  return {
    read: async (key) => {
      try {
        const buf = await readFile(join(dir, `${key}.pcm`));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    write: async (key, pcm) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.pcm`), new Uint8Array(pcm));
    },
  };
}

export interface SynthResult {
  lines: Map<string, ArrayBuffer>; // text → 16 kHz PCM16
  synthesised: number; // how many lines were NOT in the cache (= calls made)
}

/** Every `text` → 16 kHz PCM16, from the cache when present. Refuses to
 *  synthesise more than the cap in one run. */
export async function ensureLines(texts: readonly string[], tts: Synthesiser, store: LineStore): Promise<SynthResult> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const lines = new Map<string, ArrayBuffer>();
  const missing: string[] = [];
  for (const text of unique) {
    const cached = await store.read(keyOf(text));
    if (cached) lines.set(text, cached);
    else missing.push(text);
  }
  if (missing.length > MAX_LINES_PER_RUN) {
    throw new Error(`refusing to synthesise ${missing.length} lines in one run (cap ${MAX_LINES_PER_RUN})`);
  }
  for (const text of missing) {
    const out = await tts(text);
    const pcm = to16k(out);
    await store.write(keyOf(text), pcm);
    lines.set(text, pcm);
  }
  return { lines, synthesised: missing.length };
}

function to16k(out: Synthesised): ArrayBuffer {
  if (out.sampleRate === TARGET_RATE) return out.pcm;
  return float32ToPcm16(resampleLinear(pcm16ToFloat32(out.pcm), out.sampleRate, TARGET_RATE));
}

/** The estimate printed before a paid run: what will be synthesised and a
 *  rough upper bound on cost. Rates are the published flash-tier TTS prices;
 *  the lite model is cheaper, so this is an upper bound, not a bill. */
export function describeEstimate(missing: readonly string[]): string {
  const chars = missing.reduce((n, t) => n + t.length, 0);
  const seconds = Math.ceil(chars / 12); // ~12 characters of speech per second
  const usd = (chars / 4 / 1e6) * 0.5 + ((seconds * 32) / 1e6) * 10; // text in, audio out
  return `TTS ${TTS_MODEL}: ${missing.length} 句、${chars} 字元、約 ${seconds} 秒音訊，估價上限 ≈ USD ${usd.toFixed(3)}`;
}

/** The Gemini TTS model as a Synthesiser. Node only; reads the key from the
 *  caller (which reads it from the environment, never from a file). */
export function geminiTts(apiKey: string, voiceName = "Kore"): Synthesiser {
  return async (text) => {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    const mime = part?.inlineData?.mimeType ?? "";
    if (!data) throw new Error(`TTS returned no audio (${res.candidates?.[0]?.finishReason ?? "no candidate"})`);
    const rate = Number.parseInt(/rate=(\d+)/.exec(mime)?.[1] ?? "", 10);
    if (!Number.isInteger(rate)) throw new Error(`TTS returned an unexpected mime type: ${mime}`);
    const bytes = Buffer.from(data, "base64");
    return { pcm: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), sampleRate: rate };
  };
}
