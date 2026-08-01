// Pure PCM16 <-> Float32 helpers + linear resampling. No browser APIs here, so
// these are unit-testable (vitest). The browser glue lives in AudioEngine.

/** Convert Float32 samples (-1..1) to little-endian PCM16 bytes. */
export function float32ToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true /* little-endian */);
  }
  return out.buffer;
}

/** Convert little-endian PCM16 bytes to Float32 samples (-1..1). */
export function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const out = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/**
 * D1 — wrap Float32 samples in a minimal 16-bit mono WAV container.
 *
 * The coach's voice reaches us as raw provider PCM, and shadowing needs to replay
 * it next to the learner's own MediaRecorder clip. Emitting a WAV means BOTH clips
 * are ordinary media the browser can play through one `<audio>` element — no
 * AudioContext has to stay alive for replay, and this stays a pure function
 * (bytes in, bytes out) so it is unit-testable like the rest of this file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const HEADER_BYTES = 44;
  const data = float32ToPcm16(samples);
  const out = new ArrayBuffer(HEADER_BYTES + data.byteLength);
  const view = new DataView(out);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true); // file size minus "RIFF" + this field
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 2 bytes/sample)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, data.byteLength, true);
  new Uint8Array(out, HEADER_BYTES).set(new Uint8Array(data));
  return out;
}

/** Linear resample (e.g. browser 48kHz capture -> 16kHz for Gemini). */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
