const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const chunks: Array<string> = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? (bytes[i + 1] ?? 0) : 0;
    const b2 = hasB2 ? (bytes[i + 2] ?? 0) : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;
    chunks.push(
      BASE64_ALPHABET[(triplet >> 18) & 0x3f]!,
      BASE64_ALPHABET[(triplet >> 12) & 0x3f]!,
      hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f]! : "=",
      hasB2 ? BASE64_ALPHABET[triplet & 0x3f]! : "=",
    );
  }
  return chunks.join("");
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n\s]/g, "");
  if (clean.length === 0) return new Uint8Array(0);
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outputLength = Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  const out = new Uint8Array(outputLength);
  let outIndex = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);

    const v0 = c0 < 128 ? (BASE64_LOOKUP[c0] ?? 0) : 0;
    const v1 = c1 < 128 ? (BASE64_LOOKUP[c1] ?? 0) : 0;
    const v2 = c2 < 128 && clean[i + 2] !== "=" ? (BASE64_LOOKUP[c2] ?? 0) : 0;
    const v3 = c3 < 128 && clean[i + 3] !== "=" ? (BASE64_LOOKUP[c3] ?? 0) : 0;

    const triplet =
      (Math.max(0, v0) << 18) | (Math.max(0, v1) << 12) | (Math.max(0, v2) << 6) | Math.max(0, v3);
    if (outIndex < outputLength) out[outIndex++] = (triplet >> 16) & 0xff;
    if (outIndex < outputLength) out[outIndex++] = (triplet >> 8) & 0xff;
    if (outIndex < outputLength) out[outIndex++] = triplet & 0xff;
  }

  return out;
}

export function pcm16BytesToInt16(bytes: Uint8Array): Int16Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(i * 2, true);
  }
  return samples;
}

export function int16ToPcm16Bytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i] ?? 0, true);
  }
  return bytes;
}

export function resamplePcm16(
  samples: Int16Array,
  fromSampleRate: number,
  toSampleRate: number,
): Int16Array {
  if (samples.length === 0 || fromSampleRate <= 0 || toSampleRate <= 0) {
    return new Int16Array(0);
  }
  if (fromSampleRate === toSampleRate) {
    return new Int16Array(samples);
  }

  const ratio = fromSampleRate / toSampleRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Int16Array(targetLength);
  const lastIndex = samples.length - 1;

  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio;
    const index = Math.min(lastIndex, Math.floor(position));
    const nextIndex = Math.min(lastIndex, index + 1);
    const frac = position - index;
    const s0 = samples[index] ?? 0;
    const s1 = samples[nextIndex] ?? s0;
    const interpolated = Math.round(s0 + (s1 - s0) * frac);
    output[i] = Math.max(-32768, Math.min(32767, interpolated));
  }

  return output;
}

export function pcm16Base64ToResampledBase64(
  base64Pcm: string,
  fromSampleRate: number,
  toSampleRate: number,
): string {
  if (!base64Pcm || fromSampleRate === toSampleRate) {
    return base64Pcm;
  }
  const bytes = base64ToBytes(base64Pcm);
  const samples = pcm16BytesToInt16(bytes);
  const resampled = resamplePcm16(samples, fromSampleRate, toSampleRate);
  return bytesToBase64(int16ToPcm16Bytes(resampled));
}

function computePcm16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = (samples[i] ?? 0) / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSquares / samples.length));
}

export function computePcm16Base64Rms(base64Pcm: string): number {
  if (!base64Pcm) return 0;
  return computePcm16Rms(pcm16BytesToInt16(base64ToBytes(base64Pcm)));
}

export function buildWavFromPcm16(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);

  const out = new Uint8Array(44 + pcmBytes.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcmBytes, 44);
  return out;
}
